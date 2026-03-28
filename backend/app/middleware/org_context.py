from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


class OrgContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        org_id = request.headers.get("X-Org-Id", "org")
        request.state.org_id = org_id
        response = await call_next(request)
        response.headers["X-Org-Id"] = org_id
        return response
