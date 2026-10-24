# Security

Please do not commit API keys, cookies, access tokens, private URLs, or `.env` files.

## Reporting a vulnerability

For a security issue, open a private GitHub security advisory when the repository is published. Do not disclose exploitable details in a public issue.

## Deployment basics

- Use HTTPS in production.
- Set explicit `ALLOWED_ORIGINS`.
- Keep provider secrets server-side.
- Keep the built-in rate limit enabled.
- Do not treat model-generated weather signals as official emergency warnings.
