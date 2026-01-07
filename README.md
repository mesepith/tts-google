# tts-google (Google Cloud Text-to-Speech tester)

A fast, simple UI to **compare Google Cloud TTS voices** (Studio, Neural2, WaveNet, Standard, Chirp 3: HD, etc).
- Select **language / voice type / specific voice**
- Type text and **Generate**
- Autoplays audio with **Play / Pause / Stop**
- Shows **latency, characters, estimated cost, audio duration**, and more

## Ports (as requested)
- Frontend (Vite): **7068**
- Backend (Node/Express): **7069**

---

## 0) Prerequisites (one-time)
1. Enable **Cloud Text-to-Speech API** in your Google Cloud project.
2. Make sure **Billing** is enabled (you won't be charged unless you exceed free tier).
3. Create / download a **Service Account JSON key** (keep it secret).

---

## 1) Local development (Mac)
### Backend
```bash
cd server
cp .env.example .env
# Put your key at the repo root (NOT committed) as ./google-stt-tts.json
# or point GOOGLE_APPLICATION_CREDENTIALS to wherever you store it.
npm install
npm run dev
```

### Frontend
```bash
cd client
npm install
npm run dev
```

Open: http://localhost:7068

---

## 2) Build for Ubuntu server (Apache)
### Build frontend
```bash
cd client
npm install
npm run build
# copy dist -> Apache docroot
sudo rm -rf /var/www/html/tts-google
sudo mkdir -p /var/www/html/tts-google
sudo cp -r dist/* /var/www/html/tts-google/
```

### Run backend (PM2)
```bash
cd server
npm install --omit=dev

# Store the JSON key OUTSIDE the web root (recommended)
sudo mkdir -p /opt/tts-google/secrets
sudo cp ../google-stt-tts.json /opt/tts-google/secrets/google-stt-tts.json
sudo chmod 600 /opt/tts-google/secrets/google-stt-tts.json

# Start backend
export PORT=7069
export GOOGLE_APPLICATION_CREDENTIALS=/opt/tts-google/secrets/google-stt-tts.json
pm2 start index.js --name "tts-google-backend:7069" --update-env
pm2 save
```

---

## 3) Apache virtual host (HTTPS)
See `apache/tts-google.zahiralam.com.conf` in this repo.

Enable required modules:
```bash
sudo a2enmod proxy proxy_http rewrite headers ssl
sudo systemctl reload apache2
```

Then use Certbot to issue certs for `tts-google.zahiralam.com` and reload Apache.

---

## Notes
- Chirp 3: HD voices have limitations (no SSML, no speakingRate/pitch). The UI disables those automatically.
- Estimated cost is based on Google's pricing page; always verify in your Cloud Console.
