'use client';

import { useMemo, useState } from 'react';
import type { ConverterEntry } from '@/lib/converters/registry';
import QRCode from 'qrcode';

type Props = { entry: ConverterEntry };
type Mode = 'text' | 'wifi';
type ECLevel = 'L' | 'M' | 'Q' | 'H';

function wifiString(ssid: string, password: string, enc: string): string {
  const esc = (s: string) => s.replace(/([\\;,":])/g, '\\$1');
  return `WIFI:T:${enc};S:${esc(ssid)};P:${esc(password)};;`;
}

export default function QrWidget({ entry }: Props) {
  const [mode, setMode] = useState<Mode>('text');
  const [text, setText] = useState('');
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [enc, setEnc] = useState('WPA');
  const [ecLevel, setEcLevel] = useState<ECLevel>('M');
  const [margin, setMargin] = useState(2);
  const [dark, setDark] = useState('#000000');
  const [light, setLight] = useState('#ffffff');
  const [pngSize, setPngSize] = useState(1024);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payload = useMemo(() => {
    if (mode === 'wifi') {
      if (!ssid.trim()) return '';
      return wifiString(ssid.trim(), password, enc);
    }
    return text;
  }, [mode, text, ssid, password, enc]);

  const [svg, setSvg] = useState<string | null>(null);

  useMemo(() => {
    if (!payload) {
      setSvg(null);
      return;
    }
    QRCode.toString(payload, {
      type: 'svg',
      errorCorrectionLevel: ecLevel,
      margin,
      color: { dark, light },
    })
      .then(setSvg)
      .catch(() => setSvg(null));
  }, [payload, ecLevel, margin, dark, light]);

  const download = async (kind: 'svg' | 'png') => {
    if (!payload) {
      setError(mode === 'wifi' ? 'WiFi name (SSID) likho pehle.' : 'Text ya link likho pehle.');
      return;
    }
    setWorking(true);
    setError(null);
    try {
      if (kind === 'svg') {
        const s = await QRCode.toString(payload, {
          type: 'svg',
          errorCorrectionLevel: ecLevel,
          margin,
          color: { dark, light },
        });
        const blob = new Blob([s], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'qr-code.svg';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } else {
        const url = await QRCode.toDataURL(payload, {
          errorCorrectionLevel: ecLevel,
          margin,
          color: { dark, light },
          width: pngSize,
        });
        const a = document.createElement('a');
        a.href = url;
        a.download = `qr-code-${pngSize}px.png`;
        a.click();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'QR code nahi ban saka. Text chhota karke try karo.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="tool-grid has-side">
      <div className="tool-main">
        <div className="preset-row" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className={`pill-btn${mode === 'text' ? ' active' : ''}`}
            onClick={() => setMode('text')}
          >
            Text / Link
          </button>
          <button
            type="button"
            className={`pill-btn${mode === 'wifi' ? ' active' : ''}`}
            onClick={() => setMode('wifi')}
          >
            WiFi QR
          </button>
        </div>

        {mode === 'text' ? (
          <label className="opt-row">
            <span className="opt-label">Text ya link</span>
            <textarea
              rows={3}
              placeholder="https://example.com ya koi bhi text…"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
              aria-label="QR content"
              style={{ fontSize: 15, maxWidth: '32rem' }}
            />
          </label>
        ) : (
          <>
            <label className="opt-row">
              <span className="opt-label">WiFi name (SSID)</span>
              <input
                type="text"
                placeholder="e.g. HomeWiFi"
                value={ssid}
                onChange={(e) => {
                  setSsid(e.target.value);
                  setError(null);
                }}
                aria-label="WiFi SSID"
                style={{ maxWidth: '20rem' }}
              />
            </label>
            <label className="opt-row" style={{ marginTop: 8 }}>
              <span className="opt-label">Password</span>
              <input
                type="text"
                placeholder="WiFi password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-label="WiFi password"
                style={{ maxWidth: '20rem' }}
              />
            </label>
            <label className="opt-row" style={{ marginTop: 8 }}>
              <span className="opt-label">Security</span>
              <select value={enc} onChange={(e) => setEnc(e.target.value)} style={{ maxWidth: '12rem' }}>
                <option value="WPA">WPA / WPA2</option>
                <option value="WEP">WEP</option>
                <option value="nopass">No password</option>
              </select>
            </label>
          </>
        )}

        {svg && (
          <div
            style={{ marginTop: 16, background: '#fff', padding: 16, border: '1px solid var(--border, #e2e8f0)', borderRadius: 12, display: 'inline-block', maxWidth: '100%' }}
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}

        <div className="opt-grid" style={{ marginTop: 12 }}>
          <label className="opt">
            <span>Error correction</span>
            <select value={ecLevel} onChange={(e) => setEcLevel(e.target.value as ECLevel)}>
              <option value="L">L — chhota code</option>
              <option value="M">M — standard</option>
              <option value="Q">Q — zyada safe</option>
              <option value="H">H — logo ke liye best</option>
            </select>
          </label>
          <label className="opt">
            <span>QR color</span>
            <input type="color" value={dark} onChange={(e) => setDark(e.target.value)} />
          </label>
          <label className="opt">
            <span>Background</span>
            <input type="color" value={light} onChange={(e) => setLight(e.target.value)} />
          </label>
          <label className="opt">
            <span>PNG size (px)</span>
            <select value={pngSize} onChange={(e) => setPngSize(Number(e.target.value))}>
              <option value={512}>512</option>
              <option value={1024}>1024</option>
              <option value={2048}>2048</option>
            </select>
          </label>
        </div>

        {error && <p className="error">{error}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => download('svg')}
            disabled={working || !payload}
          >
            {working ? 'Working…' : 'Download SVG'}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => download('png')}
            disabled={working || !payload}
            style={{ background: '#fff', color: 'var(--brand)', border: '1px solid var(--brand)' }}
          >
            Download PNG
          </button>
        </div>
      </div>

      <aside className="tool-side">
        <h3>How it works</h3>
        <p>
          Text/Link mode me koi bhi text ya URL — phone ka camera scan karke khol
          dega. <strong>WiFi QR</strong> me ghar/office ka WiFi dalo — mehmaan scan
          karte hi connect, password batane ki zaroorat nahi.
        </p>
        <h3>Tips</h3>
        <ul>
          <li>Print ke liye SVG lo — har size par sharp.</li>
          <li>Colored QR zyada error correction (Q/H) ke sath behtar scan hota hai.</li>
          <li>Test: apne phone se scan karke dekho pehle.</li>
        </ul>
      </aside>
    </div>
  );
}
