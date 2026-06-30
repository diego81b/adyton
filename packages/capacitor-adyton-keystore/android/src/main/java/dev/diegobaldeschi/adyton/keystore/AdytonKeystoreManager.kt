package dev.diegobaldeschi.adyton.keystore

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PublicKey
import java.security.SecureRandom
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

data class PublicKeyPair(val ecdhPublicKey: String, val signPublicKey: String)
data class RelayPayload(val ciphertext: String, val iv: String, val phoneEphemeralPub: String)

class AdytonKeystoreManager(private val context: Context) {

    private fun ecdhAlias(deviceId: String) = "adyton.pak.ecdh.$deviceId"
    private fun signAlias(deviceId: String) = "adyton.pak.sign.$deviceId"

    // AES-256-GCM wrap key: per-use biometric required (setUserAuthenticationParameters(0, BIOMETRIC_STRONG)).
    // This is the security gate for vault key access — OS enforces biometric before every decrypt.
    private fun wrapAlias(deviceId: String) = "adyton.pak.wrap.$deviceId"

    private fun sealedKeyFile(deviceId: String) = File(context.filesDir, "adyton_vk_$deviceId.json")

    // --- Key generation ---

    fun generateKeys(deviceId: String): PublicKeyPair {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

        // ECDH key: no auth required. It is only used in the QR relay protocol to encrypt
        // the vault key for transport — the vault key itself is protected by the wrap key.
        if (!ks.containsAlias(ecdhAlias(deviceId))) {
            val ecdhSpec = KeyGenParameterSpec.Builder(
                ecdhAlias(deviceId),
                KeyProperties.PURPOSE_AGREE_KEY
            )
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .build()

            val ecdhKpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
            ecdhKpg.initialize(ecdhSpec)
            ecdhKpg.generateKeyPair()
        }

        // SIGN key: biometric required, 30-second window, no device credential.
        // Removes AUTH_DEVICE_CREDENTIAL so a plain lockscreen unlock cannot authorize signing.
        if (!ks.containsAlias(signAlias(deviceId))) {
            val signSpec = KeyGenParameterSpec.Builder(
                signAlias(deviceId),
                KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
            )
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(true)
                .setUserAuthenticationParameters(
                    30,
                    KeyProperties.AUTH_BIOMETRIC_STRONG
                )
                .build()

            val signKpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
            signKpg.initialize(signSpec)
            signKpg.generateKeyPair()
        }

        // AES-256-GCM wrap key: per-use biometric, no device credential.
        // Every vault key decrypt must go through BiometricPrompt with CryptoObject.
        generateWrapKey(deviceId)

        ks.load(null)
        val ecdhPub = ks.getCertificate(ecdhAlias(deviceId)).publicKey
        val signPub = ks.getCertificate(signAlias(deviceId)).publicKey
        return PublicKeyPair(base64SpkiOf(ecdhPub), base64SpkiOf(signPub))
    }

    fun getPublicKeys(deviceId: String): PublicKeyPair {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val ecdhPub = ks.getCertificate(ecdhAlias(deviceId))?.publicKey
            ?: throw IllegalStateException("ECDH key not found for deviceId=$deviceId — call generateKeys first")
        val signPub = ks.getCertificate(signAlias(deviceId))?.publicKey
            ?: throw IllegalStateException("SIGN key not found for deviceId=$deviceId — call generateKeys first")
        return PublicKeyPair(base64SpkiOf(ecdhPub), base64SpkiOf(signPub))
    }

    // --- AES wrap key management ---

    private fun generateWrapKey(deviceId: String) {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (ks.containsAlias(wrapAlias(deviceId))) return

        // Per-use biometric (timeout=0): every decrypt requires a fresh BiometricPrompt.
        // No AUTH_DEVICE_CREDENTIAL: a plain lockscreen unlock cannot authorize vault key release.
        // setInvalidatedByBiometricEnrollment: if the user adds a new fingerprint the key is wiped —
        // re-enrollment is required, preventing key inheritance by a newly added biometric.
        val spec = KeyGenParameterSpec.Builder(
            wrapAlias(deviceId),
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setKeySize(256)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(true)
            .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
            .setInvalidatedByBiometricEnrollment(true)
            .build()

        val kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        kg.init(spec)
        kg.generateKey()
    }

    // Returns a Cipher initialised for ENCRYPT_MODE with the wrap key.
    // The caller must pass this to BiometricPrompt.authenticate(CryptoObject(cipher))
    // before calling sealWithCipher — the OS enforces biometric before key use.
    fun getSealCipher(deviceId: String): Cipher {
        generateWrapKey(deviceId)
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val key = ks.getKey(wrapAlias(deviceId), null)
            ?: throw IllegalStateException("Wrap key not found for deviceId=$deviceId")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        return cipher
    }

    // Seals vault key bytes using the authenticated cipher from BiometricPrompt.
    // Stores ciphertext + IV + format version in the sealed-key file.
    fun sealWithCipher(deviceId: String, vaultKeyRaw: String, cipher: Cipher) {
        val vaultKeyBytes = Base64.decode(vaultKeyRaw, Base64.DEFAULT)
        require(vaultKeyBytes.size == 32) { "vaultKeyRaw must decode to exactly 32 bytes" }
        cipher.updateAAD("adyton-wrap-v2:$deviceId".toByteArray(Charsets.UTF_8))
        val ciphertext = cipher.doFinal(vaultKeyBytes)
        val iv = cipher.parameters.getParameterSpec(GCMParameterSpec::class.java).iv
        val json = JSONObject().apply {
            put("ct", Base64.encodeToString(ciphertext, Base64.DEFAULT))
            put("iv", Base64.encodeToString(iv, Base64.DEFAULT))
            put("v", 2)
        }
        sealedKeyFile(deviceId).writeText(json.toString())
    }

    // Returns a Cipher initialised for DECRYPT_MODE with the stored IV.
    // The caller must pass this to BiometricPrompt.authenticate(CryptoObject(cipher))
    // before calling unsealWithCipher.
    fun getUnsealCipher(deviceId: String): Cipher {
        val file = sealedKeyFile(deviceId)
        if (!file.exists()) throw IllegalStateException("No sealed vault key for deviceId=$deviceId — enroll first")
        val json = JSONObject(file.readText())
        val version = json.optInt("v", 1)
        if (version != 2) {
            throw IllegalStateException("Sealed key is format v$version (expected v2) — re-enroll biometric unlock")
        }
        val iv = Base64.decode(json.getString("iv"), Base64.DEFAULT)
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val key = ks.getKey(wrapAlias(deviceId), null)
            ?: throw IllegalStateException("Wrap key not found for deviceId=$deviceId — re-enroll biometric unlock")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
        return cipher
    }

    // Decrypts vault key bytes using the authenticated cipher from BiometricPrompt.
    // Returns the 32-byte vault key as base64.
    fun unsealWithCipher(deviceId: String, cipher: Cipher): String {
        val json = JSONObject(sealedKeyFile(deviceId).readText())
        val ciphertext = Base64.decode(json.getString("ct"), Base64.DEFAULT)
        cipher.updateAAD("adyton-wrap-v2:$deviceId".toByteArray(Charsets.UTF_8))
        val plaintext = cipher.doFinal(ciphertext)
        return Base64.encodeToString(plaintext, Base64.DEFAULT)
    }

    // --- QR relay encryption ---

    // Encrypts vaultKeyRaw for transport using ECDH with the remote ephemeral public key.
    // vaultKeyRaw must already be unsealed (passed from unsealWithCipher after biometric auth).
    fun encryptForRelayWithKey(
        deviceId: String,
        vaultKeyRaw: String,
        remotePublicKeySpki: String,
        challengeHex: String,
        sessionId: String
    ): RelayPayload {
        val vaultKeyBytes = Base64.decode(vaultKeyRaw, Base64.DEFAULT)

        val ephemeralKpg = KeyPairGenerator.getInstance("EC")
        ephemeralKpg.initialize(ECGenParameterSpec("secp256r1"))
        val phoneEphemeralKp = ephemeralKpg.generateKeyPair()

        val remoteSpkiBytes = Base64.decode(remotePublicKeySpki, Base64.DEFAULT)
        val remotePub = KeyFactory.getInstance("EC")
            .generatePublic(X509EncodedKeySpec(remoteSpkiBytes))

        val ka = KeyAgreement.getInstance("ECDH")
        ka.init(phoneEphemeralKp.private)
        ka.doPhase(remotePub, true)
        val sharedSecret = ka.generateSecret()

        val salt = hexToBytes(challengeHex)
        val okm = hkdf(
            ikm = sharedSecret,
            salt = salt,
            info = "adyton-qr-v1".toByteArray(Charsets.UTF_8),
            length = 32
        )

        val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val secretKey = SecretKeySpec(okm, "AES")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey, GCMParameterSpec(128, iv))
        cipher.updateAAD(sessionId.toByteArray(Charsets.UTF_8))
        val ciphertext = cipher.doFinal(vaultKeyBytes)

        return RelayPayload(
            ciphertext = Base64.encodeToString(ciphertext, Base64.DEFAULT),
            iv = Base64.encodeToString(iv, Base64.DEFAULT),
            phoneEphemeralPub = base64SpkiOf(phoneEphemeralKp.public)
        )
    }

    // --- Signing ---

    fun sign(deviceId: String, dataBase64: String): String {
        val data = Base64.decode(dataBase64, Base64.DEFAULT)

        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val signPrivKey = ks.getKey(signAlias(deviceId), null)
            ?: throw IllegalStateException("SIGN key not found for deviceId=$deviceId")

        val sig = java.security.Signature.getInstance("SHA256withECDSA")
        sig.initSign(signPrivKey as java.security.PrivateKey)
        sig.update(data)
        val signature = sig.sign()

        return Base64.encodeToString(signature, Base64.DEFAULT)
    }

    // --- Key existence / deletion ---

    // Returns true if ALL keys required for a fully enrolled device exist.
    // For PAK: ECDH + SIGN + wrap key + sealed file must all be present.
    // Returns false if any component is missing, triggering re-enrollment.
    fun hasKeys(deviceId: String): Boolean {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return ks.containsAlias(ecdhAlias(deviceId)) &&
               ks.containsAlias(signAlias(deviceId)) &&
               ks.containsAlias(wrapAlias(deviceId)) &&
               sealedKeyFile(deviceId).exists()
    }

    // Returns true if a Phase 8 (non-PAK) biometric enrollment exists:
    // the wrap key + sealed file are present (no ECDH/SIGN keys required).
    fun hasRawKey(deviceId: String): Boolean {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return ks.containsAlias(wrapAlias(deviceId)) && sealedKeyFile(deviceId).exists()
    }

    fun deleteKeys(deviceId: String) {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        listOf(ecdhAlias(deviceId), signAlias(deviceId), wrapAlias(deviceId)).forEach { alias ->
            if (ks.containsAlias(alias)) ks.deleteEntry(alias)
        }
        val file = sealedKeyFile(deviceId)
        if (file.exists()) file.delete()
    }

    // --- HKDF (RFC 5869) using HmacSHA256 ---

    private fun hkdf(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
        val prk = hmacSha256(salt, ikm)
        val output = ByteArray(length)
        var tPrev = ByteArray(0)
        var offset = 0
        var counter = 1
        while (offset < length) {
            val block = hmacSha256(prk, tPrev + info + byteArrayOf(counter.toByte()))
            val toCopy = minOf(block.size, length - offset)
            System.arraycopy(block, 0, output, offset, toCopy)
            offset += toCopy
            tPrev = block
            counter++
        }
        return output
    }

    private fun hmacSha256(key: ByteArray, data: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(data)
    }

    // --- Helpers ---

    private fun base64SpkiOf(pubKey: PublicKey): String =
        Base64.encodeToString(pubKey.encoded, Base64.NO_WRAP)

    private fun hexToBytes(hex: String): ByteArray {
        val normalized = hex.lowercase()
        require(normalized.length % 2 == 0) { "Hex string must have even length" }
        return ByteArray(normalized.length / 2) { i ->
            normalized.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        }
    }
}
