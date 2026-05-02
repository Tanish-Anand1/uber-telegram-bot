const speech = require('@google-cloud/speech');
const axios = require('axios');

const client = new speech.SpeechClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
});

/**
 * Convert Telegram voice message (OGG/OPUS) to text
 */
async function convertVoiceToText(voiceUrl) {
  try {
    console.log('[SPEECH] Converting voice to text');

    const audioResponse = await axios.get(voiceUrl, {
      responseType: 'arraybuffer'
    });

    const audioContent = Buffer.from(audioResponse.data).toString('base64');

    const request = {
      audio: { content: audioContent },
      config: {
        encoding: 'OGG_OPUS',
        sampleRateHertz: 16000,
        languageCode: 'en-US',
        alternativeLanguageCodes: ['hi-IN', 'es-ES', 'fr-FR', 'de-DE'],
        model: 'command_and_search'
      }
    };

    const [response] = await client.recognize(request);
    const transcription = response.results
      .map(r => r.alternatives[0]?.transcript || '')
      .join(' ')
      .trim();

    console.log(`[SPEECH] Transcript: "${transcription}"`);
    return transcription || null;
  } catch (error) {
    console.error('[SPEECH] Conversion error:', error.message);
    return null;
  }
}

/**
 * Detect language from voice (returns BCP-47 language code)
 */
async function detectLanguage(voiceUrl) {
  try {
    const audioResponse = await axios.get(voiceUrl, {
      responseType: 'arraybuffer'
    });

    const audioContent = Buffer.from(audioResponse.data).toString('base64');

    const request = {
      audio: { content: audioContent },
      config: {
        encoding: 'OGG_OPUS',
        sampleRateHertz: 16000,
        languageCode: 'en-US',
        alternativeLanguageCodes: ['hi-IN', 'es-ES', 'fr-FR', 'de-DE']
      }
    };

    const [response] = await client.recognize(request);
    return response.results[0]?.languageCode || 'en-US';
  } catch (error) {
    console.error('[SPEECH] Language detection error:', error.message);
    return 'en-US';
  }
}

module.exports = { convertVoiceToText, detectLanguage };
