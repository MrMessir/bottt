# StudBot Mini App (GitHub Pages)

Telegram Mini App frontend for StudBot.

**Live URL:** https://mrmessir.github.io/bottt/

## API backend

GitHub Pages serves only static files. Set your bot API URL in `index.html`:

```html
<meta name="api-base" content="https://your-api-host.example.com" />
```

Then in bot `.env`:

```
MINI_APP_URL=https://mrmessir.github.io/bottt/
```

Register this URL in [@BotFather](https://t.me/BotFather) → Bot Settings → Menu Button / Web App.
