import sys
from pathlib import Path

# 设置正确的 PYTHONPATH
src_path = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(src_path))

from fastapi.testclient import TestClient
from simgame.webapp import create_app

def test_rollback_preview():
    # 获取应用实例，并调试其返回值
    print("Calling create_app()...")
    app = create_app()
    print(f"app is: {app}")
    
    if app is None:
        raise Exception("create_app() returned None - check webapp.py return statements")
    
    client = TestClient(app)
    
    # 测试获取回滚预览
    print("Testing /api/bi/actions/rollback/preview...")
    res = client.post("/api/bi/actions/rollback/preview", json={"checkpoint_id": "test_cp"})
    
    print(f"Status Code: {res.status_code}")
    print(f"Response: {res.json()}")

if __name__ == "__main__":
    try:
        test_rollback_preview()
        print("测试脚本执行成功")
    except Exception as e:
        print(f"测试脚本执行失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
