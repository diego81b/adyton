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
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

data class PublicKeyPair(val ecdhPublicKey: String, val signPublicKey: String)
data class RelayPayload(val ciphertext: String, val iv: String, val phoneEphemeralPub: String)

class AdytonKeystoreManager(private val context: Context) {

    private fun ecdhAlias(deviceId: String) = "adyton.pak.ecdh.$deviceId"
    private fun signAlias(deviceId: String) = "adyton.pak.sign.$deviceId"
    private fun sealedKeyFile(deviceId: String) = File(context.filesDir, "adyton_vk_$deviceId.json")

    // --- Key generation ---

    fun generateKeys(deviceId: String): PublicKeyPair {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

        // Generate ECDH key if not present
        if (!ks.containsAlias(ecdhAlias(deviceId))) {
            val ecdhSpec = KeyGenParameterSpec.Builder(
                ecdhAlias(deviceId),
                KeyProperties.PURPOSE_AGREE_KEY
            )
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setUserAuthenticationRequired(true)
                .setUserAuthenticationParameters(
                    30,
                    KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL
                )
                .build()

            val ecdhKpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
            ecdhKpg.initialize(ecdhSpec)
            ecdhKpg.generateKeyPair()
        }

        // Generate SIGN key if not present
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
                    KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL
                )
                .build()

            val signKpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
            signKpg.initialize(signSpec)
            signKpg.generateKeyPair()
        }

        // Reload keystore to get fresh references
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

    // --- Vault key sealing ---

    fun sealVaultKey(deviceId: String, vaultKeyRaw: String) {
        val vaultKeyBytes = Base64.decode(vaultKeyRaw, Base64.DEFAULT)
        require(vaultKeyBytes.size == 32) { "vaultKeyRaw must decode to exactly 32 bytes" }

        // Generate ephemeral EC P-256 keypair in SOFTWARE (not Keystore)
        val ephemeralKpg = KeyPairGenerator.getInstance("EC")
        ephemeralKpg.initialize(ECGenParameterSpec("secp256r1"))
        val ephemeralKp = ephemeralKpg.generateKeyPair()

        // Get persistent ECDH private key from Keystore
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val persistentPrivKey = ks.getKey(ecdhAlias(deviceId), null)
            ?: throw IllegalStateException("ECDH key not found for deviceId=$deviceId")

        // ECDH: persistent priv + ephemeral pub → shared secret
        val ka = KeyAgreement.getInstance("ECDH")
        ka.init(persistentPrivKey)
        ka.doPhase(ephemeralKp.public, true)
        val sharedSecret = ka.generateSecret()

        // HKDF with info = "adyton-seal-v1"
        val okm = hkdf(
            ikm = sharedSecret,
            salt = ByteArray(32),
            info = "adyton-seal-v1".toByteArray(Charsets.UTF_8),
            length = 32
        )

        // AES-GCM encrypt
        val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val secretKey = SecretKeySpec(okm, "AES")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey, GCMParameterSpec(128, iv))
        cipher.updateAAD("seal:$deviceId".toByteArray(Charsets.UTF_8))
        val ciphertext = cipher.doFinal(vaultKeyBytes)

        // Store JSON
        val json = JSONObject().apply {
            put("ct", Base64.encodeToString(ciphertext, Base64.DEFAULT))
            put("iv", Base64.encodeToString(iv, Base64.DEFAULT))
            put("eph", base64SpkiOf(ephemeralKp.public))
        }
        sealedKeyFile(deviceId).writeText(json.toString())
    }

    fun unsealVaultKey(deviceId: String): String {
        val json = JSONObject(sealedKeyFile(deviceId).readText())
        val ciphertext = Base64.decode(json.getString("ct"), Base64.DEFAULT)
        val iv = Base64.decode(json.getString("iv"), Base64.DEFAULT)
        val ephPubSpki = Base64.decode(json.getString("eph"), Base64.DEFAULT)

        // Reconstruct ephemeral public key
        val ephPub = KeyFactory.getInstance("EC")
            .generatePublic(X509EncodedKeySpec(ephPubSpki))

        // Get persistent ECDH private key from Keystore (triggers biometric if needed)
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val persistentPrivKey = ks.getKey(ecdhAlias(deviceId), null)
            ?: throw IllegalStateException("ECDH key not found for deviceId=$deviceId")

        // ECDH: persistent priv + ephemeral pub → same shared secret
        val ka = KeyAgreement.getInstance("ECDH")
        ka.init(persistentPrivKey)
        ka.doPhase(ephPub, true)
        val sharedSecret = ka.generateSecret()

        // HKDF same parameters
        val okm = hkdf(
            ikm = sharedSecret,
            salt = ByteArray(32),
            info = "adyton-seal-v1".toByteArray(Charsets.UTF_8),
            length = 32
        )

        // AES-GCM decrypt
        val secretKey = SecretKeySpec(okm, "AES")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(128, iv))
        cipher.updateAAD("seal:$deviceId".toByteArray(Charsets.UTF_8))
        val plaintext = cipher.doFinal(ciphertext)

        return Base64.encodeToString(plaintext, Base64.DEFAULT)
    }

    // --- QR relay encryption ---

    fun encryptForRelay(
        deviceId: String,
        remotePublicKeySpki: String,
        challengeHex: String,
        sessionId: String
    ): RelayPayload {
        // Unseal vault key (triggers biometric via the ECDH Keystore key)
        val vaultKeyRaw = unsealVaultKey(deviceId)
        val vaultKeyBytes = Base64.decode(vaultKeyRaw, Base64.DEFAULT)

        // Generate phone ephemeral keypair in SOFTWARE
        val ephemeralKpg = KeyPairGenerator.getInstance("EC")
        ephemeralKpg.initialize(ECGenParameterSpec("secp256r1"))
        val phoneEphemeralKp = ephemeralKpg.generateKeyPair()

        // Decode remote public key
        val remoteSpkiBytes = Base64.decode(remotePublicKeySpki, Base64.DEFAULT)
        val remotePub = KeyFactory.getInstance("EC")
            .generatePublic(X509EncodedKeySpec(remoteSpkiBytes))

        // ECDH: phone ephemeral priv + remote pub → shared secret
        val ka = KeyAgreement.getInstance("ECDH")
        ka.init(phoneEphemeralKp.private)
        ka.doPhase(remotePub, true)
        val sharedSecret = ka.generateSecret()

        // HKDF: salt = challengeHex bytes, info = "adyton-qr-v1"
        val salt = hexToBytes(challengeHex)
        val okm = hkdf(
            ikm = sharedSecret,
            salt = salt,
            info = "adyton-qr-v1".toByteArray(Charsets.UTF_8),
            length = 32
        )

        // AES-GCM encrypt vault key bytes with AAD = sessionId
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

        val sig = Signature.getInstance("SHA256withECDSA")
        sig.initSign(signPrivKey as java.security.PrivateKey)
        sig.update(data)
        val signature = sig.sign()

        return Base64.encodeToString(signature, Base64.DEFAULT)
    }

    // --- Key existence / deletion ---

    fun hasKeys(deviceId: String): Boolean {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return ks.containsAlias(ecdhAlias(deviceId)) && ks.containsAlias(signAlias(deviceId))
    }

    fun deleteKeys(deviceId: String) {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (ks.containsAlias(ecdhAlias(deviceId))) {
            ks.deleteEntry(ecdhAlias(deviceId))
        }
        if (ks.containsAlias(signAlias(deviceId))) {
            ks.deleteEntry(signAlias(deviceId))
        }
        val file = sealedKeyFile(deviceId)
        if (file.exists()) {
            file.delete()
        }
    }

    // --- HKDF (RFC 5869) using HmacSHA256 ---

    /**
     * HKDF extract-then-expand.
     *
     * Extract: PRK = HMAC-SHA256(salt, IKM)
     * Expand:  OKM = T(1) || T(2) || ... where T(i) = HMAC-SHA256(PRK, T(i-1) || info || i)
     *          T(0) = empty
     */
    private fun hkdf(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
        // Extract
        val prk = hmacSha256(salt, ikm)

        // Expand
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

    /** Returns the DER-encoded SPKI of a public key as base64 (NO_WRAP for clean transport). */
    private fun base64SpkiOf(pubKey: PublicKey): String =
        Base64.encodeToString(pubKey.encoded, Base64.NO_WRAP)

    /** Decodes a lowercase or uppercase hex string to a ByteArray. */
    private fun hexToBytes(hex: String): ByteArray {
        val normalized = hex.lowercase()
        require(normalized.length % 2 == 0) { "Hex string must have even length" }
        return ByteArray(normalized.length / 2) { i ->
            normalized.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        }
    }
}
