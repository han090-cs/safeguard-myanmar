"""Small helper for the start scripts (start-windows.bat, start-linux.sh). Standard library only.

    python tools/launch_helper.py port-in-use 8000                 exit 0 if something already listens on the port
    python tools/launch_helper.py open-when-ready http://127.0.0.1:8000/
                                                                   wait (up to 60 s) for the server, then open the browser
"""
import socket
import sys
import time
import urllib.request
import webbrowser


def port_in_use(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(1)
        return s.connect_ex(("127.0.0.1", port)) == 0


def open_when_ready(url: str, seconds: int = 60) -> bool:
    for _ in range(seconds):
        try:
            urllib.request.urlopen(url.rstrip("/") + "/health", timeout=2)
        except Exception:
            time.sleep(1)
            continue
        if not webbrowser.open(url):
            print(f"== Open {url} in your browser.")
        return True
    print("!! The server did not answer within 60 seconds - see the messages above.")
    return False


if __name__ == "__main__":
    cmd, arg = sys.argv[1], sys.argv[2]
    if cmd == "port-in-use":
        sys.exit(0 if port_in_use(int(arg)) else 1)
    if cmd == "open-when-ready":
        sys.exit(0 if open_when_ready(arg) else 1)
    sys.exit(f"unknown command {cmd}")
