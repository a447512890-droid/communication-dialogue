"""生成 GitHub Pages 展示文件，仅包含原型及其读取的数据与图片。"""

import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=str(ROOT / ".pages"))
    args = parser.parse_args()
    target = Path(args.output).resolve()
    if target == ROOT or ROOT.is_relative_to(target):
        raise ValueError("发布目录不能是项目根目录或其上级目录")
    if target.exists() and any(target.iterdir()):
        raise ValueError("发布目录必须为空，请使用新的输出目录")
    target.mkdir(parents=True, exist_ok=True)
    files = [
        '原型/index.html', '原型/app.js', '原型/styles.css',
        '原型/input-rules.js', '原型/realtime.js', '原型/requirements-live.js',
    ]
    files += [
        'docs/产品需求/需求说明.md',
        'docs/产品需求/需求列表.md',
        'docs/产品需求/效率拨号产品功能清单.md',
        'docs/产品需求/整体技术实现流程图.md',
        'docs/产品需求/订阅会员流程.md',
        'docs/产品需求/恢复购买流程.md',
    'docs/产品需求/绑定手机号流程.md',
        'docs/产品需求/录音与转写技术说明.md',
        'docs/产品需求/技术字段关联说明.md',
        'docs/产品需求/输入字段与AI上下文规则.md',
        'docs/产品需求/待接入能力清单.md',
        'docs/产品需求/数据处理授权规则.md',
        'docs/AI/场景化演练提示词.md',
        'docs/AI/演练总结提示词.md',
        'docs/AI/AI通话分析提示词.md',
        'docs/商店资料/元数据-打前演练打后复盘.md',
        'docs/更新日志.md',
    ]
    for name in files:
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, destination)
    (target / ".nojekyll").touch()
    (target / "index.html").write_text(
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8">'
        '<title>打电话-AI商务实时电话沟通训练官</title><script>'
        'location.replace("./原型/"+location.search+location.hash);'
        '</script><a href="./原型/">打开商务电话训练原型</a></html>\n',
        encoding="utf-8",
    )
    print(f"已生成 Pages 展示文件：{target}")


if __name__ == "__main__":
    main()
