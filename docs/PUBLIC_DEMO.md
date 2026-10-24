# Public demo from your own computer (Cloudflare Quick Tunnel)

Show the site to anyone on a public **HTTPS** link while it runs on your laptop. Free, no Cloudflare account.
Good for a demo or a test. It is **not** for real, always-on use (see "Limits").

## မြန်မာလို အကျဉ်းချုပ်

1. **တစ်ခါပဲ လုပ်ရမယ့်အရာ** - `cloudflared` ထည့်ပါ (Ubuntu):
   ```bash
   sudo mkdir -p --mode=0755 /usr/share/keyrings
   curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
   echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
   sudo apt-get update && sudo apt-get install cloudflared
   cloudflared --version
   ```
2. **တစ်ခါပဲ လုပ်ရမယ့်အရာ** - Python package တွေ ထည့်ပြီး test လုပ်ပါ (`ModuleNotFoundError: fastapi` မဖြစ်တော့ပါဘူး):
   ```bash
   bash setup_and_test.sh
   ```
3. **ပြမယ့်အချိန်တိုင်း**:
   ```bash
   bash public_demo.sh
   ```
   `PUBLIC LINK: https://....trycloudflare.com` ပေါ်လာပါမယ်။ အဲဒီ link ကို ပြပါ။ Ctrl+C နှိပ်ရင် ရပ်ပြီး link ပျက်သွားပါမယ်။
4. **ကိုယ့်ဖုန်းမှာ စစ်ပါ** - Wi-Fi မဟုတ်ဘဲ **mobile data** နဲ့ link ကို ဖွင့်ကြည့်ပါ (အပြင်ကနေ တကယ်ရောက်လား စစ်တာပါ)။

ပြဿနာ ဖြစ်ရင်:
- link မပေါ်ဘူးဆိုရင် `TUNNEL_PROTOCOL=http2 bash public_demo.sh` နဲ့ ပြန်စမ်းပါ (UDP ပိတ်ထားတဲ့ network အတွက်)။
- `~/.cloudflared/config.yaml` ရှိနေရင် ဖယ်ပါ: `mv ~/.cloudflared/config.yaml ~/.cloudflared/config.yaml.bak`
- Log ကြည့်ရန်: `/tmp/safeguard-site.log`, `/tmp/safeguard-tunnel.log`
- Laptop ကို အိပ်မသွားစေနဲ့ (power ချိတ်ပါ)။ အိပ်ရင် link ပျက်ပါတယ်၊ ပြန်စရင် link အသစ်ရပါမယ်။

## Limits (from Cloudflare's documentation)

- No uptime guarantee; the link dies when the process stops and a new run gives a **new** link.
- Up to 200 requests in flight at once (more get HTTP 429).
- Server-Sent Events are not supported (this app does not use them).
- Anyone with the link can open it. Show real data only if you are happy for that.

For something that must stay up, deploy the Docker image (see `DEPLOY_FREE.md`) or use a named Cloudflare Tunnel.

## Manual commands (what the script does)

```bash
.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --proxy-headers
cloudflared tunnel --url http://127.0.0.1:8000        # use 127.0.0.1, not localhost (IPv6 can cause 502)
```
