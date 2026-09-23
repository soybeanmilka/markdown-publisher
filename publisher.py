#!/usr/bin/env python3
"""把一篇 Obsidian Markdown 整理成多平台可发布文件。无需第三方依赖。"""

import argparse
import html
import re
from pathlib import Path


def remove_frontmatter(text: str) -> str:
    """移除 Obsidian 属性区，避免复制到平台时把 YAML 一起带过去。"""
    return re.sub(r"\A---\s*\n.*?\n---\s*\n", "", text, count=1, flags=re.DOTALL)


def clean_obsidian_syntax(text: str) -> str:
    """将 [[笔记|显示名]] 转成普通文本；外链 Markdown 保持不动。"""
    def replace_link(match):
        target, label = match.group(1), match.group(2)
        return label or target

    return re.sub(r"\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]", replace_link, text)


def title_from(text: str, fallback: str) -> str:
    for line in text.splitlines():
        match = re.match(r"^#\s+(.+?)\s*$", line)
        if match:
            return match.group(1)
    return fallback


def summary_from(text: str) -> str:
    for line in text.splitlines():
        if line.startswith("> "):
            return line[2:].strip()
    return ""


def inline_markdown_to_html(value: str) -> str:
    escaped = html.escape(value)
    escaped = re.sub(r"`([^`]+)`", r"<code style=\"background:#f3f4f6;padding:2px 4px;border-radius:3px\">\1</code>", escaped)
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", escaped)
    escaped = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r"<a href=\"\2\">\1</a>", escaped)
    return escaped


def markdown_to_wechat_html(markdown: str, title: str) -> str:
    """生成内联样式 HTML，浏览器打开后全选复制到公众号编辑器。"""
    body = []
    in_code = False
    code_lines = []
    in_list = False

    def close_list():
        nonlocal in_list
        if in_list:
            body.append("</ul>")
            in_list = False

    for raw in markdown.splitlines():
        line = raw.rstrip()
        if line.startswith("```"):
            close_list()
            if in_code:
                body.append('<pre style="background:#1f2937;color:#f9fafb;padding:14px;overflow:auto;border-radius:6px"><code>')
                body.append(html.escape("\n".join(code_lines)))
                body.append("</code></pre>")
                code_lines = []
            in_code = not in_code
            continue
        if in_code:
            code_lines.append(raw)
            continue
        if not line:
            close_list()
            continue
        heading = re.match(r"^(#{1,3})\s+(.+)$", line)
        if heading:
            close_list()
            level = len(heading.group(1))
            size = {1: "26px", 2: "21px", 3: "18px"}[level]
            body.append(f'<h{level} style="font-size:{size};line-height:1.45;margin:28px 0 12px;color:#1f2937">{inline_markdown_to_html(heading.group(2))}</h{level}>')
            continue
        if line.startswith("- ") or line.startswith("* "):
            if not in_list:
                body.append('<ul style="padding-left:24px;line-height:1.9">')
                in_list = True
            body.append(f"<li>{inline_markdown_to_html(line[2:])}</li>")
            continue
        close_list()
        if line.startswith("> "):
            body.append(f'<blockquote style="margin:16px 0;padding:10px 14px;border-left:4px solid #07c160;background:#f6ffed;color:#4b5563">{inline_markdown_to_html(line[2:])}</blockquote>')
        else:
            body.append(f'<p style="font-size:16px;line-height:1.9;margin:0 0 14px;color:#374151">{inline_markdown_to_html(line)}</p>')
    close_list()
    if in_code:
        body.append(f'<pre><code>{html.escape(chr(10).join(code_lines))}</code></pre>')

    return "\n".join([
        "<!doctype html>",
        '<html lang="zh-CN"><head><meta charset="utf-8"><title>' + html.escape(title) + "</title></head>",
        '<body style="max-width:720px;margin:32px auto;padding:0 20px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,PingFang SC,Microsoft YaHei,sans-serif">',
        *body,
        "</body></html>",
    ])


def write_outputs(source: Path, output_root: Path) -> Path:
    raw = source.read_text(encoding="utf-8")
    article = clean_obsidian_syntax(remove_frontmatter(raw)).strip() + "\n"
    title = title_from(article, source.stem)
    summary = summary_from(article)
    destination = output_root / source.stem
    destination.mkdir(parents=True, exist_ok=True)

    (destination / "公众号.html").write_text(markdown_to_wechat_html(article, title), encoding="utf-8")
    for platform in ("知乎", "掘金", "CSDN", "小红书长文"):
        (destination / f"{platform}.md").write_text(article, encoding="utf-8")

    checklist = f"""# 发布清单：{title}

## 标题

{title}

## 摘要

{summary or '（从正文提炼一句摘要）'}

## 发布顺序

1. 公众号：打开 `公众号.html`，在浏览器中全选正文并复制，再粘贴到公众号编辑器。
2. 知乎、掘金、CSDN：打开同名 `.md`，复制正文到对应编辑器。
3. 发布前检查标题、封面、代码块和所有链接；不同平台的格式会略有差异。

> 本工具只生成可发布稿件，不登录账号、不上传内容、不绕过任何平台或插件的权限限制。
"""
    (destination / "发布清单.md").write_text(checklist, encoding="utf-8")
    return destination


def main():
    parser = argparse.ArgumentParser(description="生成多平台发布稿件")
    parser.add_argument("source", type=Path, help="要发布的 Markdown 文件")
    parser.add_argument("--out", type=Path, default=Path("output"), help="输出目录（默认 output）")
    args = parser.parse_args()
    if not args.source.is_file():
        parser.error(f"找不到 Markdown 文件：{args.source}")
    result = write_outputs(args.source, args.out)
    print(f"已生成：{result.resolve()}")


if __name__ == "__main__":
    main()
