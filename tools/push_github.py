# -*- coding: utf-8 -*-
"""一键提交后的自动推送：同时推当前分支与 master（Pages 部署分支）。

用法（仓库根目录或任意目录）：
    python tools/push_github.py            # 推送已提交的内容
    python tools/push_github.py --dry-run  # 只报告将要推送什么

背景：全局 gitconfig 里有一条
    http.https://github.com.proxy = http://127.0.0.1:12000
代理程序没启动时，这条配置会让 git 直接连一个死端口，push 报
"Could not connect to server"。本脚本先用「去掉该代理的临时 GIT_CONFIG_GLOBAL」
直连推送；失败再用原配置（走代理）重试。全局配置本身不修改。
"""
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROXY_HOST_HINT = "127.0.0.1"


def git(args, env=None, check=False):
    p = subprocess.run(["git"] + args, cwd=ROOT, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=env)
    if check and p.returncode != 0:
        raise RuntimeError("git %s 失败: %s" % (" ".join(args), (p.stderr or p.stdout).strip()))
    return p


def global_config_path():
    return os.environ.get("GIT_CONFIG_GLOBAL") or os.path.join(os.path.expanduser("~"), ".gitconfig")


def make_no_proxy_config():
    """复制全局 gitconfig，去掉 [http "https://github.com"] 段里的 proxy 配置。"""
    src = global_config_path()
    if not os.path.exists(src):
        return None
    lines = open(src, encoding="utf-8", errors="replace").read().splitlines()
    out, skip_section = [], False
    for ln in lines:
        m = re.match(r"^\s*\[\s*([^\]]+?)\s*\]\s*$", ln)
        if m:
            skip_section = bool(re.search(r"http\s+\"https://github\.com\"", m.group(1), re.I))
            if skip_section:
                continue
        if skip_section:
            continue
        out.append(ln)
    tmp = os.path.join(tempfile.gettempdir(), "_gitconfig_noproxy")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(out).rstrip() + "\n")
    return tmp


def push_once(env, note):
    branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()
    results = []
    targets = [branch] + ([] if branch == "master" else ["HEAD:master"])
    for t in targets:
        p = git(["push", "origin", t], env=env)
        ok = p.returncode == 0
        msg = (p.stderr or p.stdout).strip().splitlines()
        results.append((t, ok, msg[-1] if msg else ""))
        if not ok:
            return results, False
    return results, True


def main():
    dry = "--dry-run" in sys.argv
    if git(["rev-parse", "--is-inside-work-tree"]).returncode != 0:
        sys.exit("不在 git 仓库里: " + ROOT)

    branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()
    dirty = [l for l in git(["status", "--porcelain"]).stdout.splitlines() if l.strip()]
    print("仓库: %s\n分支: %s" % (ROOT, branch))
    if dirty:
        print("注意：工作区有 %d 个未提交改动（本脚本只推送已提交内容）" % len(dirty))

    if dry:
        print("将推送: origin %s 与 origin HEAD:master" % branch)
        print(git(["log", "--oneline", "-3"]).stdout.rstrip())
        return 0

    # 先直连（去掉死代理），失败再走原配置（代理）
    for note, env in (("直连（已跳过 127.0.0.1 代理）", None), ("原配置（走代理）", "default")):
        if note.startswith("直连"):
            tmp = make_no_proxy_config()
            if not tmp:
                continue
            e = dict(os.environ)
            e["GIT_CONFIG_GLOBAL"] = tmp
        else:
            e = dict(os.environ)
            e.pop("GIT_CONFIG_GLOBAL", None)
        print("\n[尝试] %s" % note)
        results, ok = push_once(e, note)
        for t, good, last in results:
            print("  %-14s %s  %s" % (t, "OK" if good else "FAIL", last))
        if ok:
            print("\n推送完成。master 已更新，GitHub Pages 会在 1–2 分钟内重新构建。")
            return 0
    print("\n推送失败：直连与代理两种方式都没成功。"
          "\n请检查网络，或启动本机代理（全局配置指向 127.0.0.1:12000）。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
