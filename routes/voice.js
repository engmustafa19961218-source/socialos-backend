module.exports = function(app, pool, helpers) {
const { escapeHtml, sanitize, authenticateToken, rateLimit, esc } = helpers;

// ============================================================
// VOICE — الصوت (Whisper + TTS)
// ============================================================

// تحويل صوت → نص (Whisper)
app.post('/api/voice/transcribe', authenticateToken, async (req, res) => {
  const { audio_base64, mime_type } = req.body;
  if (!audio_base64) return res.status(400).json({ success: false, message: 'الصوت مطلوب' });
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return res.status(503).json({ success: false, message: 'OPENAI_API_KEY غير مضبوط' });
  try {
    const audioBuffer = Buffer.from(audio_base64, 'base64');
    const boundary = '----WhisperBoundary' + Date.now();
    const ext = (mime_type || 'audio/webm').includes('mp4') ? 'mp4' : 'webm';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${mime_type||'audio/webm'}\r\n\r\n`),
      audioBuffer,
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nar\r\n`),
      Buffer.from(`--${boundary}--`)
    ]);
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body
    });
    const d = await r.json();
    if (d.error) return res.status(400).json({ success: false, message: d.error.message });
    res.json({ success: true, text: d.text || '' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// تحويل نص → صوت (TTS)
app.post('/api/voice/speak', authenticateToken, async (req, res) => {
  const { text, voice, speed } = req.body;
  if (!text) return res.status(400).json({ success: false, message: 'النص مطلوب' });
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return res.status(503).json({ success: false, message: 'OPENAI_API_KEY غير مضبوط' });
  try {
    // جلب إعدادات الصوت المحفوظة
    let voiceTone = voice || 'alloy', voiceSpeed = speed || 1.0;
    if (pool) {
      const vp = await pool.query('SELECT voice_tone, voice_speed FROM voice_profile WHERE user_id=$1', [req.user.id]);
      if (vp.rows.length) { voiceTone = voice || vp.rows[0].voice_tone; voiceSpeed = speed || vp.rows[0].voice_speed; }
    }
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1-hd', input: text.substring(0, 4096), voice: voiceTone, speed: voiceSpeed, response_format: 'mp3' })
    });
    if (!r.ok) { const e = await r.json(); return res.status(400).json({ success: false, message: e.error?.message || 'فشل TTS' }); }
    const audioBuffer = await r.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString('base64');
    res.json({ success: true, audio_base64: base64Audio, mime_type: 'audio/mp3' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// حفظ ملف الصوت
app.post('/api/voice/profile', authenticateToken, async (req, res) => {
  const { voice_tone, voice_speed, voice_style } = req.body;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    await pool.query(
      `INSERT INTO voice_profile (user_id, voice_tone, voice_speed, voice_style, updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (user_id) DO UPDATE SET voice_tone=$2, voice_speed=$3, voice_style=$4, updated_at=NOW()`,
      [req.user.id, voice_tone||'alloy', voice_speed||1.0, voice_style||'']
    );
    res.json({ success: true, message: 'تم حفظ إعدادات الصوت' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

};
