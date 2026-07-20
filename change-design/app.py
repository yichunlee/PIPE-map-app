"""
變更設計 API — 把桌面版核心邏輯（change_core + parse_boq，原封不動重用）
包成 HTTP 服務，供管線施工進度管理網站的網頁介面呼叫。

端點：
  GET  /health    健康檢查
  POST /parse     上傳原契約 .xlsx → 回傳分組/工項樹（JSON）
  POST /generate  上傳原契約 .xlsx + 變更狀態(JSON) → 回傳變更設計明細表 .xlsx

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

from change_core import ChangeModel, NewItem, generate_change_xlsx, is_rate_item

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
    return {'success': True, 'groups': groups}


@app.post('/generate')
async def generate(file: UploadFile = File(...),
                   state: str = Form('{}'),
                   before_label: str = Form('前次修正預算'),
                   after_label: str = Form('第N次變更設計'),
                   x_user_token: str = Header(default='')):
    _verify(x_user_token)
    try:
        model = _load_model(await file.read())
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f'解析原契約失敗：{e}')

    try:
        data = json.loads(state or '{}')
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f'變更狀態 JSON 格式錯誤：{e}')

    # 套用變更（與桌面版 load_state 相同語意）
    try:
        for code, qty in (data.get('changes') or {}).items():
            model.set_new_qty(code, float(qty))
    except KeyError as e:
        raise HTTPException(400, f'變更狀態含有原契約找不到的項次：{e}')
    model.new_items = [NewItem.from_dict(d) for d in (data.get('new_items') or [])]
    model.rate_amounts = {
        k: {'inc': float(v.get('inc', 0)), 'dec': float(v.get('dec', 0))}
        for k, v in (data.get('rate_amounts') or {}).items()
    }

    out_tmp = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    out_tmp.close()
    try:
        generate_change_xlsx(model, out_tmp.name,
                             before_label=before_label, after_label=after_label)
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
