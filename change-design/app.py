"""
變更設計 API — 把桌面版核心邏輯（change_core + parse_boq，原封不動重用）
包成 HTTP 服務，供管線施工進度管理網站的網頁介面呼叫。

端點：
  GET  /health    健康檢查
  POST /parse     上傳原契約 .xlsx → 回傳分組/工項樹（JSON）
  POST /generate  上傳原契約 .xlsx + 變更狀態(JSON) → 回傳變更設計明細表 .xlsx
  GET  /dgs       代抓公路局道路申挖 KML（給 Cloudflare Worker 用的中繼站）

驗證：
  設定環境變數 GOOGLE_CLIENT_ID 後，所有請求需帶 X-User-Token
  （前端登入取得的 Google ID Token，與主網站同一套）。
  未設定則不驗證（開發模式）。
CORS：
  環境變數 ALLOWED_ORIGIN（預設 * ；正式環境建議填你的網站網址）。
"""
import json
import os
import tempfile

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from change_core import (ChangeModel, NewItem, generate_change_xlsx,
                         generate_detail_boq, is_rate_item)

GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '')
ALLOWED_ORIGIN = os.environ.get('ALLOWED_ORIGIN', '*')
# 免登入模式：預設不驗證。只有明確設定 REQUIRE_AUTH=1（且有 GOOGLE_CLIENT_ID）才強制登入。
REQUIRE_AUTH = os.environ.get('REQUIRE_AUTH', '') == '1'

app = FastAPI(title='變更設計 API', version='1.0')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'] if ALLOWED_ORIGIN == '*' else [ALLOWED_ORIGIN],
    allow_methods=['*'],
    allow_headers=['*'],
)


def _verify(token: str):
    """驗證 Google ID Token。免登入模式（預設）直接放行。"""
    if not REQUIRE_AUTH or not GOOGLE_CLIENT_ID:
        return  # 免登入模式：不驗證
    if not token:
        raise HTTPException(401, '需要登入（缺少 X-User-Token）')
    try:
        from google.auth.transport import requests as grequests
        from google.oauth2 import id_token as gid
        info = gid.verify_oauth2_token(token, grequests.Request(), GOOGLE_CLIENT_ID)
        if not info.get('email'):
            raise ValueError('token 中沒有 email')
    except Exception as e:  # noqa: BLE001
        raise HTTPException(401, f'登入憑證無效或已過期：{e}')


def _load_model(file_bytes: bytes) -> ChangeModel:
    """把上傳的 xlsx 寫到暫存檔，交給原本的 ChangeModel（它吃檔案路徑）。"""
    tmp = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    try:
        tmp.write(file_bytes)
        tmp.close()
        return ChangeModel(tmp.name)
    finally:
        os.unlink(tmp.name)


def _safe_ancestors(g):
    out = []
    for a in getattr(g, 'ancestors', []) or []:
        if isinstance(a, (list, tuple)):
            out.append([str(x) for x in a])
        else:
            out.append(str(a))
    return out


@app.get('/health')
def health():
    return {'ok': True, 'auth': bool(GOOGLE_CLIENT_ID)}


@app.post('/parse')
async def parse(file: UploadFile = File(...),
                x_user_token: str = Header(default='')):
    _verify(x_user_token)
    try:
        model = _load_model(await file.read())
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f'解析原契約失敗：{e}')

    groups = []
    for g in model.groups:
        groups.append({
            'code': g.code,
            'desc': g.desc,
            'ancestors': _safe_ancestors(g),
            'leaves': [{
                'code': lf.code,
                'desc': lf.desc,
                'unit': lf.unit,
                'orig_qty': lf.orig_qty,
                'price': lf.price if isinstance(lf.price, (int, float)) else str(lf.price or ''),
                'orig_total': lf.orig_total,
                'remark': lf.remark,
                'is_rate': bool(is_rate_item(lf)),
            } for lf in g.leaves],
        })
    # 順便把原契約抬頭抓到的工程名稱/編號回傳，讓前端自動帶入（使用者仍可改）
    return {'success': True, 'groups': groups,
            'proj_name': getattr(model, 'proj_name', ''),
            'proj_no': getattr(model, 'proj_no', '')}


def _apply_state(model: ChangeModel, state: str):
    """把前端送來的變更狀態 JSON 套用到 model（含編號防呆）。"""
    try:
        data = json.loads(state or '{}')
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f'變更狀態 JSON 格式錯誤：{e}')
    try:
        for code, qty in (data.get('changes') or {}).items():
            model.set_new_qty(code, float(qty))
    except KeyError as e:
        raise HTTPException(400, f'變更狀態含有原契約找不到的項次：{e}')
    model.new_items = [NewItem.from_dict(d) for d in (data.get('new_items') or [])]
    seen_codes = set()
    for it in model.new_items:
        if it.code in model.leaf_by_code or it.code in model.group_by_code:
            raise HTTPException(400, f'新增項目編號「{it.code}」與原契約項次重複，請修改後再產生')
        if it.code in seen_codes:
            raise HTTPException(400, f'新增項目編號「{it.code}」重複出現，請修改後再產生')
        seen_codes.add(it.code)
    model.rate_amounts = {
        k: {'inc': float(v.get('inc', 0)), 'dec': float(v.get('dec', 0))}
        for k, v in (data.get('rate_amounts') or {}).items()
    }
    model.reasons = {
        k: str(v) for k, v in (data.get('reasons') or {}).items() if str(v).strip()
    }
    return model


@app.post('/generate_detail')
async def generate_detail(file: UploadFile = File(...),
                          state: str = Form('{}'),
                          title_suffix: str = Form('（變更設計後）'),
                          x_user_token: str = Header(default='')):
    """產生『變更後詳細價目表』——格式同原契約，可作為下一次變更設計的輸入。
    注意：generate_detail_boq 需要重新開啟原始檔（逐列搬 A 欄相對代號），
    因此這裡自行保留原始暫存檔，直到產完詳細表才刪除（不能用會即時刪檔的 _load_model）。"""
    _verify(x_user_token)
    src_tmp = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    out_tmp = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    out_tmp.close()
    try:
        src_tmp.write(await file.read())
        src_tmp.close()
        try:
            model = ChangeModel(src_tmp.name)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, f'解析原契約失敗：{e}')
        _apply_state(model, state)
        try:
            generate_detail_boq(model, out_tmp.name, title_suffix=title_suffix)
            with open(out_tmp.name, 'rb') as f:
                content = f.read()
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001
            raise HTTPException(500, f'產生變更後詳細價目表失敗：{e}')
    finally:
        for p in (src_tmp.name, out_tmp.name):
            try:
                os.unlink(p)
            except OSError:
                pass
    return Response(
        content,
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={'Content-Disposition': 'attachment; filename="detail_boq.xlsx"'},
    )


@app.post('/generate')
async def generate(file: UploadFile = File(...),
                   state: str = Form('{}'),
                   before_label: str = Form('前次修正預算'),
                   after_label: str = Form('第N次變更設計'),
                   proj_name: str = Form(''),
                   proj_no: str = Form(''),
                   x_user_token: str = Header(default='')):
    _verify(x_user_token)
    try:
        model = _load_model(await file.read())
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f'解析原契約失敗：{e}')
    _apply_state(model, state)

    out_tmp = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    out_tmp.close()
    try:
        generate_change_xlsx(model, out_tmp.name,
                             before_label=before_label, after_label=after_label,
                             proj_name=proj_name, proj_no=proj_no)
        with open(out_tmp.name, 'rb') as f:
            content = f.read()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f'產生明細表失敗：{e}')
    finally:
        os.unlink(out_tmp.name)

    return Response(
        content,
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={'Content-Disposition': 'attachment; filename="change_design.xlsx"'},
    )


# ══════════════════════════════════════════════════════════════════
# 公路局道路申挖 KML 中繼站
#
# 為什麼需要這個：公路局（dgs.thb.gov.tw）擋在 Imperva Incapsula 後面，
# 會封鎖來自 Cloudflare 的出口 IP（回 403 + _Incapsula_Resource 頁面），
# 所以 Cloudflare Worker 沒辦法直接抓。這台在 fly.io（東京），IP 段不同，
# 由它代抓再轉給 Worker 解析。
# ══════════════════════════════════════════════════════════════════

DGS_CITIES = {
    '基隆市', '新北市', '台北市', '桃園市', '新竹縣', '新竹市', '苗栗縣',
    '台中市', '南投縣', '彰化縣', '雲林縣', '嘉義縣', '嘉義市', '台南市',
    '高雄市', '屏東縣', '宜蘭縣', '花蓮縣', '台東縣',
}

# 程序內快取（機器會自動休眠，所以只是盡力而為，能省一次是一次）
_DGS_CACHE: dict = {}
_DGS_TTL = 300  # 秒


@app.get('/dgs')
def dgs_kml(city: str = '台中市', force: int = 0):
    """代抓指定縣市的道路申挖 KML，原封不動回傳文字。"""
    import time

    import requests

    city = (city or '台中市').strip().replace('臺', '台')
    if city not in DGS_CITIES:
        raise HTTPException(400, f'不支援的縣市：{city}（離島無省道）')

    now = time.time()
    hit = _DGS_CACHE.get(city)
    if hit and not force and (now - hit[0]) < _DGS_TTL:
        return Response(hit[1], media_type='application/vnd.google-earth.kml+xml',
                        headers={'X-Dgs-Cache': 'hit'})

    url = f'https://dgs.thb.gov.tw/thbdgs/CMMDGS/TEMP/DGS_{city}.kml'
    headers = {
        'User-Agent': ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                       '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://dgs.thb.gov.tw/THBDGS/',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
    }
    try:
        r = requests.get(url, headers=headers, timeout=30)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f'連線公路局失敗：{e}')

    if r.status_code != 200:
        # 把上游回應原樣帶出來，才分得清是被 WAF 擋還是單純掛掉
        preview = ' '.join(r.text.split())[:600] if r.text else ''
        blocked = '_Incapsula_Resource' in r.text or 'incap_ses' in str(r.headers)
        raise HTTPException(502, {
            'error': f'公路局回應 HTTP {r.status_code}',
            'blockedByWaf': blocked,
            'upstreamStatus': r.status_code,
            'bodyPreview': preview,
        })

    r.encoding = 'utf-8'
    text = r.text

    # Incapsula 也會用 HTTP 200 包裝 JS 挑戰頁，不能只看狀態碼
    if _looks_blocked(text):
        raise HTTPException(502, {
            'error': '公路局回應 200 但內容是 WAF 挑戰頁',
            'blockedByWaf': True,
            'upstreamStatus': r.status_code,
            'bodyPreview': ' '.join(text.split())[:600],
        })
    if '<Placemark' not in text and '<kml' not in text:
        raise HTTPException(502, {
            'error': '回應內容不是 KML',
            'blockedByWaf': False,
            'upstreamStatus': r.status_code,
            'bodyPreview': ' '.join(text.split())[:600],
        })

    _DGS_CACHE[city] = (now, text)
    return Response(text, media_type='application/vnd.google-earth.kml+xml',
                    headers={'X-Dgs-Cache': 'miss'})


def _looks_blocked(text: str) -> bool:
    """判斷回應是不是 WAF 的攔截／挑戰頁（Incapsula 會用 200 或 403 兩種包法）。"""
    if not text:
        return False
    marks = ('_Incapsula_Resource', 'incap_ses', 'visid_incap',
             'Incapsula incident', 'Request unsuccessful')
    return any(m in text for m in marks)


@app.get('/dgs/probe')
def dgs_probe():
    """一次探測所有候選資料來源，回報各自能不能從這台機器抓到。

    目的：確認除了被 Incapsula 擋住的 dgs.thb.gov.tw 之外，
    有沒有別的網域可以拿到同一批申挖資料。
    """
    import requests

    ua = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
          '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36')

    targets = [
        ('KML（目前用的，已知被擋）',
         'https://dgs.thb.gov.tw/thbdgs/CMMDGS/TEMP/DGS_台中市.kml'),
        ('公路局申挖系統首頁（getDgsApply 用的）',
         'https://dgs.thb.gov.tw/THBDGS/'),
        ('data.gov.tw 資料集 API',
         'https://data.gov.tw/api/v2/rest/dataset/96513'),
        ('交通部全台彙總 CSV',
         'https://www.motc.gov.tw/uploaddowndoc?file=datagov/1317019914636103680.csv&flag=doc'),
    ]

    out = []
    for label, url in targets:
        row = {'label': label, 'url': url}
        try:
            r = requests.get(url, headers={'User-Agent': ua,
                                           'Accept-Language': 'zh-TW,zh;q=0.9'},
                             timeout=25)
            body = r.content[:4000]
            try:
                text = body.decode('utf-8', errors='replace')
            except Exception:  # noqa: BLE001
                text = ''
            row.update({
                'status': r.status_code,
                'contentType': r.headers.get('content-type', ''),
                'totalBytes': len(r.content),
                'blockedByWaf': _looks_blocked(text) or _looks_blocked(str(r.headers)),
                'looksLikeKml': '<Placemark' in text,
                'preview': ' '.join(text.split())[:250],
            })
        except Exception as e:  # noqa: BLE001
            row.update({'status': None, 'error': str(e)})
        out.append(row)

    return {'ok': True, 'results': out}
