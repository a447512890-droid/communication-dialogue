"""启动原型及演练语音接口，与独立demo共用Node服务。"""

import argparse
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    node = shutil.which("node")
    if not node:
        parser.error("未找到Node.js，请安装Node.js后重试。演练语音需要Node服务。")
    env = os.environ.copy()
    env["PORT"] = str(args.port)
    print(f"原型及语音服务：http://127.0.0.1:{args.port}/", flush=True)
    os.chdir(ROOT)
    os.execve(node, [node, str(ROOT / "qwen-ai-practice-demo/server.mjs")], env)


if __name__ == "__main__":
    main()
