/** The Sonar Pro subscription id this browser holds. PayPal is asked whether it is active before it covers a brief. */
const KEY = 'sonar:pro:subscription';
export const getPro = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setPro = (id: string | null) => { try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* private mode */ } };
