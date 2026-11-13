import { strictFormat } from '../utils/text.js';
import { getKey, hasKey } from '../utils/keys.js';

// Strata is an OpenAI-compatible inference gateway. It serves a single
// thinking-capable model ("iq3_s", Qwen3.8-Flash-Next) which puts its chain of
// thought in `reasoning_content` and the actual reply in `content`.
const DEFAULT_BASE_URL = 'https://strata.phwog.site/v1';
const DEFAULT_MODEL = 'iq3_s';
const MAX_ATTEMPTS = 4;

export class Strata {
    static prefix = 'strata';

    constructor(model_name, url, params) {
        this.model_name = model_name || DEFAULT_MODEL;
        this.base_url = (url || DEFAULT_BASE_URL).replace(/\/+$/, '');
        this.params = params;
    }

    async sendRequest(turns, systemMessage, stop_seq = '***', options = {}) {
        const messages = [{ role: 'system', content: systemMessage }, ...strictFormat(turns)];
        const stop = Array.isArray(stop_seq) ? stop_seq : (stop_seq ? [stop_seq] : []);
        let disableThinking = false;
        let finalRes = null;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            let data;
            try {
                const body = {
                    model: this.model_name,
                    messages,
                    stream: false,
                    ...(this.params || {}),
                    ...(options.body || {}),
                };
                if (stop.length > 0)
                    body.stop = stop;
                if (disableThinking) {
                    body.chat_template_kwargs = {
                        ...(body.chat_template_kwargs || {}),
                        enable_thinking: false,
                    };
                }
                console.log(`Awaiting strata api response... (model: ${this.model_name}, attempt: ${attempt})`);
                data = await this.send(body);
            }
            catch (err) {
                if (this.isContextLengthError(err) && turns.length > 1) {
                    console.log('Context length exceeded, trying again with shorter context.');
                    return await this.sendRequest(turns.slice(1), systemMessage, stop_seq, options);
                }
                console.log(err);
                const retryable = err.status === 429 || (err.status >= 500 && err.status < 600) || !err.status;
                if (retryable && attempt < MAX_ATTEMPTS) {
                    const delayMs = Math.min(1000 * 2 ** (attempt - 1), 10000);
                    console.log(`Strata request failed (${err.status ?? 'network error'}), retrying in ${delayMs}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                    continue;
                }
                return 'My brain disconnected, try again.';
            }

            const choice = data?.choices?.[0];
            const content = this.extractText(choice?.message);
            if (choice?.finish_reason === 'length') {
                console.warn('Strata response stopped with finish_reason=length.');
            }
            if (content) {
                finalRes = content;
                break;
            }

            // The model can spend its whole budget inside reasoning_content and
            // return a null message. Ask again with thinking turned off so the
            // caller still gets an answer instead of an empty one.
            if (!disableThinking) {
                console.warn('Strata returned no message content, retrying with thinking disabled...');
                disableThinking = true;
                continue;
            }
        }

        if (finalRes == null) {
            console.warn('Could not get a valid response from Strata after max attempts.');
            finalRes = 'My brain disconnected, try again.';
        }
        return finalRes;
    }

    async sendVisionRequest(messages, systemMessage, imageBuffer) {
        const payload = [
            { role: 'system', content: systemMessage },
            ...strictFormat(messages),
            {
                role: 'user',
                content: [
                    { type: 'text', text: systemMessage },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
                        }
                    }
                ]
            }
        ];

        const data = await this.send({
            model: this.model_name,
            messages: payload,
            stream: false,
            ...(this.params || {}),
            chat_template_kwargs: {
                ...(this.params?.chat_template_kwargs || {}),
                enable_thinking: false,
            },
        });

        const text = this.extractText(data?.choices?.[0]?.message);
        if (!text) {
            throw new Error('Strata vision API returned no text');
        }
        return text;
    }

    embed() {
        return Promise.reject(new Error('Embeddings are not supported by Strata. Set a separate embedding provider in the profile.'));
    }

    extractText(message) {
        let content = message?.content;
        if (Array.isArray(content)) {
            content = content.map(part => typeof part === 'string' ? part : (part?.text || '')).join('');
        }
        if (typeof content !== 'string')
            return '';
        content = content.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/g, '');
        return content.trim();
    }

    isContextLengthError(err) {
        const message = (err?.message || '').toLowerCase();
        return message.includes('context length')
            || message.includes('context_length_exceeded')
            || message.includes('exceeds the available context');
    }

    async send(body) {
        const headers = { 'Content-Type': 'application/json' };
        if (hasKey('STRATA_API_KEY')) {
            const apiKey = getKey('STRATA_API_KEY');
            if (apiKey && apiKey !== 'optional')
                headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const res = await fetch(`${this.base_url}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
        const raw = await res.text();
        let data = null;
        if (raw) {
            try {
                data = JSON.parse(raw);
            }
            catch {
                data = null;
            }
        }

        if (!res.ok) {
            const details = data?.error?.message || data?.error || raw.slice(0, 300);
            const err = new Error(`Strata API status ${res.status}${details ? ': ' + (typeof details === 'string' ? details : JSON.stringify(details)) : ''}`);
            err.status = res.status;
            throw err;
        }
        if (!data) {
            throw new Error('Strata API returned an empty response.');
        }
        return data;
    }
}
