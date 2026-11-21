import nacl from "tweetnacl";
import { APP_NAME } from "./config";

const utf8 = new TextEncoder();
export const vaultMessage = (host: string, wallet: string) =>
	utf8.encode(
		`${APP_NAME} vault unlock v1 | domain:${host} | wallet:${wallet}`,
	);

export async function deriveSeed(
	secret: Uint8Array<ArrayBuffer>,
	host: string,
	purpose = "veil-vault-v1",
) {
	const key = await crypto.subtle.importKey("raw", secret, "HKDF", false, [
		"deriveBits",
	]);
	return new Uint8Array(
		await crypto.subtle.deriveBits(
			{
				name: "HKDF",
				hash: "SHA-256",
				salt: utf8.encode(host),
				info: utf8.encode(purpose),
			},
			key,
			256,
		),
	);
}

export const encode = (bytes: Uint8Array) =>
	btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
export const decode = (value: string) =>
	Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

export async function dealEncryptionKey(
	seed: Uint8Array<ArrayBuffer>,
	host: string,
) {
	const secret = await deriveSeed(seed, host, "veil-otc-encryption-v1");
	try {
		return nacl.box.keyPair.fromSecretKey(secret);
	} finally {
		secret.fill(0);
	}
}

export function sealTerms(message: string, recipient: Uint8Array) {
	const ephemeral = nacl.box.keyPair();
	const nonce = nacl.randomBytes(nacl.box.nonceLength);
	try {
		const payload = nacl.box(
			utf8.encode(message),
			nonce,
			recipient,
			ephemeral.secretKey,
		);
		return [encode(ephemeral.publicKey), encode(nonce), encode(payload)].join(
			".",
		);
	} finally {
		ephemeral.secretKey.fill(0);
	}
}

export function openTerms(envelope: string, secret: Uint8Array) {
	const [publicKey, nonce, payload] = envelope.split(".").map(decode);
	const message = nacl.box.open(payload, nonce, publicKey, secret);
	if (!message) throw new Error("Could not decrypt terms");
	return new TextDecoder().decode(message);
}
