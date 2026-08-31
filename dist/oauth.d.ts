export type AntigravityOAuthCredentials = {
    access: string;
    refresh: string;
    expires: number;
    accountId: string;
};
export declare function parseAntigravityCallback(raw: string, state: string): string;
export declare function beginAntigravityBrowserLogin(): Promise<{
    url: string;
    complete(): Promise<AntigravityOAuthCredentials>;
}>;
export declare function beginAntigravityHeadlessLogin(): {
    url: string;
    complete(callback: string): Promise<AntigravityOAuthCredentials>;
};
export declare function refreshAntigravityToken(refresh: string, accountId?: string): Promise<AntigravityOAuthCredentials>;
