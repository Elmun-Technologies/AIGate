import requests

from app.models.tool import Tool


def execute_tool_call(tool: Tool, args: dict) -> dict:
    try:
        response = requests.request(
            method=tool.method.upper(),
            url=tool.base_url,
            json=args,
            timeout=20,
        )
        try:
            body = response.json()
        except ValueError:
            body = {"raw": response.text}
        return {
            "ok": response.ok,
            "status_code": response.status_code,
            "body": body,
        }
    except Exception as exc:
        return {
            "ok": False,
            "status_code": 500,
            "body": {"error": str(exc)},
        }
