const KEY = 'ts.devicePasskey';
const LOCK_KEY = 'ts.deviceLock';

const mobileDevice = () => matchMedia('(max-width: 900px)').matches && matchMedia('(pointer: coarse)').matches;
const supported = () => window.isSecureContext && 'PublicKeyCredential' in window && !!navigator.credentials?.create && !!navigator.credentials?.get;

function readPasskey() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY));
    return typeof value?.id === 'string' ? value : null;
  } catch { return null; }
}

const bytesToBase64Url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const base64UrlToBytes = (value) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
};
const randomBytes = (size) => crypto.getRandomValues(new Uint8Array(size));

export const shouldOfferDevicePasskey = () => mobileDevice() && supported() && !readPasskey();
export const canUseDevicePasskeyLock = () => mobileDevice() && supported();
export const isDeviceLockEnabled = () => {
  if (!canUseDevicePasskeyLock() || !readPasskey()) return false;
  try { return localStorage.getItem(LOCK_KEY) !== 'off'; } catch { return true; }
};
export const requiresDevicePasskey = isDeviceLockEnabled;
export async function setDeviceLockEnabled(enabled) {
  if (!canUseDevicePasskeyLock()) throw new Error('Passkeys are unavailable in this browser.');
  if (!enabled) { localStorage.setItem(LOCK_KEY, 'off'); return; }
  if (!readPasskey()) await registerDevicePasskey();
  localStorage.setItem(LOCK_KEY, 'on');
}

export async function registerDevicePasskey() {
  if (!supported()) throw new Error('Passkeys are unavailable in this browser.');
  const credential = await navigator.credentials.create({ publicKey: {
    challenge: randomBytes(32),
    rp: { name: 'Timesheet' },
    user: { id: randomBytes(16), name: 'timesheet-device', displayName: 'Timesheet on this device' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    attestation: 'none',
    timeout: 60000,
  } });
  if (!credential) throw new Error('Passkey registration was cancelled.');
  const record = { id: bytesToBase64Url(credential.rawId), createdAt: Date.now() };
  try { localStorage.setItem(KEY, JSON.stringify(record)); localStorage.setItem(LOCK_KEY, 'on'); }
  catch { throw new Error('Could not save this device passkey.'); }
}

export async function unlockWithDevicePasskey(signal) {
  const passkey = readPasskey();
  if (!passkey) throw new Error('No passkey is registered on this device.');
  const challenge = randomBytes(32);
  const credential = await navigator.credentials.get({ publicKey: {
    challenge,
    allowCredentials: [{ type: 'public-key', id: base64UrlToBytes(passkey.id) }],
    userVerification: 'required',
    timeout: 60000,
    signal,
  } });
  if (!credential || bytesToBase64Url(credential.rawId) !== passkey.id) throw new Error('Passkey verification failed.');

  const clientData = JSON.parse(new TextDecoder().decode(credential.response.clientDataJSON));
  const authenticatorData = new Uint8Array(credential.response.authenticatorData);
  const rpIdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(location.hostname)));
  if (clientData.type !== 'webauthn.get' || clientData.origin !== location.origin || clientData.challenge !== bytesToBase64Url(challenge)) throw new Error('Passkey verification failed.');
  if (authenticatorData.length < 37 || !(authenticatorData[32] & 0x01) || !(authenticatorData[32] & 0x04)) throw new Error('Device verification was not confirmed.');
  if (!rpIdHash.every((byte, index) => byte === authenticatorData[index])) throw new Error('Passkey belongs to a different site.');
}