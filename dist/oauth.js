import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
const REDIRECT_URI = 'http://localhost:51121/oauth-callback';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID ||
    atob('MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlc' +
        'C5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==');
const CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET ||
    atob('R09DU1BYLUs1OEZXUjQ' + '4NkxkTEoxbUxCOHNYQzR6NnFEQWY=');
const SCOPES = [
    'https://www.googleapis.com/auth/aicode',
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs',
];
function redact(value) {
    return value
        .replace(/\bya29\.[A-Za-z0-9._~+/-]+=*/g, '[redacted-access-token]')
        .replace(/\b1\/[A-Za-z0-9_-]{20,}/g, '[redacted-refresh-token]')
        .slice(0, 300);
}
function stableProjectId(seed) {
    const bytes = createHash('sha1').update(`antigravity:${seed}`).digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function extractProjectId(value) {
    if (!value || typeof value !== 'object')
        return undefined;
    const data = value;
    for (const key of [
        'antigravityProjectId',
        'projectId',
        'backendProjectId',
        'userDefinedCloudaicompanionProject',
        'cloudaicompanionProject',
        'project',
    ]) {
        const candidate = data[key];
        if (typeof candidate === 'string' && candidate)
            return candidate;
        if (candidate && typeof candidate === 'object') {
            const id = candidate.id;
            if (typeof id === 'string' && id)
                return id;
        }
    }
    for (const key of ['projects', 'projectIds', 'cloudaicompanionProjects']) {
        const candidates = data[key];
        if (!Array.isArray(candidates))
            continue;
        for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate)
                return candidate;
            const nested = extractProjectId(candidate);
            if (nested)
                return nested;
        }
    }
    return undefined;
}
function apiHeaders(access) {
    return {
        authorization: `Bearer ${access}`,
        'content-type': 'application/json',
        'user-agent': 'antigravity/hub/2.8.0 (aidev_client; os_type=linux; arch=x64; cl=963137146)',
        'x-goog-api-client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
        'client-metadata': JSON.stringify({
            ideType: 'ANTIGRAVITY',
            platform: 'LINUX',
            pluginType: 'GEMINI',
        }),
    };
}
async function discoverProject(access) {
    const base = process.env.ANTIGRAVITY_BASE_URL || 'https://daily-cloudcode-pa.googleapis.com';
    for (const [path, body] of [
        [
            '/v1internal:loadCodeAssist',
            {
                metadata: {
                    ideType: 'ANTIGRAVITY',
                    platform: 'PLATFORM_UNSPECIFIED',
                    pluginType: 'GEMINI',
                },
            },
        ],
        ['/v1internal:listCloudAICompanionProjects', {}],
    ]) {
        try {
            const response = await fetch(`${base}${path}`, {
                method: 'POST',
                headers: apiHeaders(access),
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(8000),
            });
            if (response.ok) {
                const project = extractProjectId(await response.json());
                if (project)
                    return project;
            }
        }
        catch { }
    }
    return undefined;
}
async function userEmail(access) {
    try {
        const response = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
            headers: { authorization: `Bearer ${access}` },
            signal: AbortSignal.timeout(8000),
        });
        if (!response.ok)
            return undefined;
        const data = (await response.json());
        return data.email;
    }
    catch {
        return undefined;
    }
}
function loginParameters() {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        scope: SCOPES.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'consent',
    });
    return { verifier, state, url: `${AUTH_URL}?${query.toString()}` };
}
export function parseAntigravityCallback(raw, state) {
    const text = raw.trim();
    let url;
    try {
        url = new URL(text);
    }
    catch {
        url = new URL(`http://localhost:51121/oauth-callback?${text.replace(/^\?/, '')}`);
    }
    const error = url.searchParams.get('error');
    if (error)
        throw new Error(`Google OAuth failed: ${error.slice(0, 200)}`);
    if (url.searchParams.get('state') !== state)
        throw new Error('Google OAuth state mismatch');
    const code = url.searchParams.get('code');
    if (!code)
        throw new Error('Google OAuth callback is missing its code');
    return code;
}
async function exchangeCode(code, verifier) {
    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code,
            grant_type: 'authorization_code',
            redirect_uri: REDIRECT_URI,
            code_verifier: verifier,
        }),
        signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
        throw new Error(`Google token exchange failed: ${redact(await response.text())}`);
    const data = (await response.json());
    if (!data.access_token || !data.refresh_token) {
        throw new Error('Google OAuth returned incomplete credentials');
    }
    const [email, project] = await Promise.all([
        userEmail(data.access_token),
        discoverProject(data.access_token),
    ]);
    return {
        access: data.access_token,
        refresh: data.refresh_token,
        expires: Date.now() + (data.expires_in ?? 3600) * 1000 - 5 * 60 * 1000,
        accountId: process.env.ANTIGRAVITY_PROJECT_ID ||
            project ||
            stableProjectId(email || 'antigravity-default'),
    };
}
function waitForCallback(state) {
    return new Promise((resolve, reject) => {
        let settle;
        let fail;
        const code = new Promise((done, failed) => {
            settle = done;
            fail = failed;
        });
        const server = createServer((request, response) => {
            try {
                if (request.method !== 'GET' || !request.url)
                    throw new Error('Invalid OAuth callback');
                const value = parseAntigravityCallback(request.url, state);
                response.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
                response.end('Antigravity authentication complete. Return to OpenCode.');
                settle(value);
            }
            catch (error) {
                response.writeHead(400, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
                response.end('Antigravity authentication failed.');
                fail(error instanceof Error ? error : new Error(String(error)));
            }
        });
        server.once('error', reject);
        server.listen(51121, '127.0.0.1', () => {
            resolve({ code, close: () => closeServer(server) });
        });
    });
}
function closeServer(server) {
    if ('closeAllConnections' in server)
        server.closeAllConnections();
    server.close();
}
export async function beginAntigravityBrowserLogin() {
    const login = loginParameters();
    const callback = await waitForCallback(login.state);
    return {
        url: login.url,
        async complete() {
            try {
                return await exchangeCode(await callback.code, login.verifier);
            }
            finally {
                callback.close();
            }
        },
    };
}
export function beginAntigravityHeadlessLogin() {
    const login = loginParameters();
    return {
        url: login.url,
        complete: (callback) => exchangeCode(parseAntigravityCallback(callback, login.state), login.verifier),
    };
}
export async function refreshAntigravityToken(refresh, accountId) {
    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            refresh_token: refresh,
            grant_type: 'refresh_token',
        }),
        signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
        throw new Error(`Google token refresh failed: ${redact(await response.text())}`);
    const data = (await response.json());
    if (!data.access_token)
        throw new Error('Google token refresh returned no access token');
    return {
        access: data.access_token,
        refresh: data.refresh_token || refresh,
        expires: Date.now() + (data.expires_in ?? 3600) * 1000 - 5 * 60 * 1000,
        accountId: process.env.ANTIGRAVITY_PROJECT_ID ||
            accountId ||
            (await discoverProject(data.access_token)) ||
            stableProjectId('antigravity-default'),
    };
}
