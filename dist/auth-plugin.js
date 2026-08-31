import { beginAntigravityBrowserLogin, beginAntigravityHeadlessLogin, refreshAntigravityToken, } from './oauth.js';
let refreshPromise;
const AntigravityAuthPlugin = async ({ client }) => ({
    auth: {
        provider: 'antigravity',
        async loader(getAuth) {
            const auth = await getAuth();
            if (auth.type === 'api')
                return { apiKey: auth.key };
            if (auth.type !== 'oauth')
                return {};
            const accountId = auth.accountId || auth.enterpriseUrl;
            if (auth.expires > Date.now())
                return { apiKey: auth.access, projectId: accountId };
            refreshPromise ??= refreshAntigravityToken(auth.refresh, accountId).finally(() => {
                refreshPromise = undefined;
            });
            const refreshed = await refreshPromise;
            await client.auth.set({
                path: { id: 'antigravity' },
                body: {
                    type: 'oauth',
                    access: refreshed.access,
                    refresh: refreshed.refresh,
                    expires: refreshed.expires,
                    enterpriseUrl: refreshed.accountId,
                },
            });
            return { apiKey: refreshed.access, projectId: refreshed.accountId };
        },
        methods: [
            {
                type: 'oauth',
                label: 'Google (browser)',
                async authorize() {
                    const login = await beginAntigravityBrowserLogin();
                    return {
                        url: login.url,
                        instructions: 'Complete Google sign-in in your browser. OpenCode captures the callback.',
                        method: 'auto',
                        async callback() {
                            try {
                                const credentials = await login.complete();
                                return { type: 'success', ...credentials };
                            }
                            catch {
                                return { type: 'failed' };
                            }
                        },
                    };
                },
            },
            {
                type: 'oauth',
                label: 'Google (headless)',
                async authorize() {
                    const login = beginAntigravityHeadlessLogin();
                    return {
                        url: login.url,
                        instructions: 'Complete Google sign-in, then paste the full localhost callback URL from the browser.',
                        method: 'code',
                        async callback(code) {
                            try {
                                const credentials = await login.complete(code);
                                return { type: 'success', ...credentials };
                            }
                            catch {
                                return { type: 'failed' };
                            }
                        },
                    };
                },
            },
        ],
    },
});
export default AntigravityAuthPlugin;
