package dev.diegobaldeschi.adyton.keystore

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import javax.crypto.Cipher

@CapacitorPlugin(name = "AdytonKeystore")
class AdytonKeystorePlugin : Plugin() {

    private val manager: AdytonKeystoreManager by lazy { AdytonKeystoreManager(context) }

    @PluginMethod
    fun generateKeys(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: return call.reject("deviceId required")
        try {
            val result = manager.generateKeys(deviceId)
            call.resolve(JSObject().apply {
                put("ecdhPublicKey", result.ecdhPublicKey)
                put("signPublicKey", result.signPublicKey)
            })
        } catch (e: Exception) {
            call.reject(e.message ?: "generateKeys failed", e)
        }
    }

    @PluginMethod
    fun getPublicKeys(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: return call.reject("deviceId required")
        try {
            val result = manager.getPublicKeys(deviceId)
            call.resolve(JSObject().apply {
                put("ecdhPublicKey", result.ecdhPublicKey)
                put("signPublicKey", result.signPublicKey)
            })
        } catch (e: Exception) {
            call.reject(e.message ?: "getPublicKeys failed", e)
        }
    }

    // Sealing requires a BiometricPrompt CryptoObject so the OS-enforced biometric
    // gates key use — a DevTools call cannot bypass this by reordering JS.
    @PluginMethod
    fun sealVaultKey(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: return call.reject("deviceId required")
        val vaultKeyRaw = call.getString("vaultKeyRaw") ?: return call.reject("vaultKeyRaw required")
        try {
            val cipher = manager.getSealCipher(deviceId)
            bridge.executeOnMainThread {
                showBiometricPrompt(
                    cipher = cipher,
                    subtitle = "Secure vault key",
                    call = call,
                ) { authedCipher ->
                    manager.sealWithCipher(deviceId, vaultKeyRaw, authedCipher)
                    call.resolve()
                }
            }
        } catch (e: Exception) {
            call.reject(e.message ?: "sealVaultKey failed", e)
        }
    }

    // Unsealing requires a BiometricPrompt CryptoObject — OS enforces biometric
    // before the AES-GCM key is released for decryption.
    @PluginMethod
    fun unsealVaultKey(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: return call.reject("deviceId required")
        try {
            val cipher = manager.getUnsealCipher(deviceId)
            bridge.executeOnMainThread {
                showBiometricPrompt(
                    cipher = cipher,
                    subtitle = "Unlock vault",
                    call = call,
                ) { authedCipher ->
                    val raw = manager.unsealWithCipher(deviceId, authedCipher)
                    call.resolve(JSObject().apply { put("vaultKeyRaw", raw) })
                }
            }
        } catch (e: Exception) {
            call.reject(e.message ?: "unsealVaultKey failed", e)
        }
    }

    // QR relay: unseal (biometric prompt) then ECDH-encrypt for relay.
    // Biometric auth is required before the vault key is exposed in memory.
    @PluginMethod
    fun encryptForRelay(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: return call.reject("deviceId required")
        val remotePublicKeySpki = call.getString("remotePublicKeySpki") ?: return call.reject("remotePublicKeySpki required")
        val challengeHex = call.getString("challengeHex") ?: return call.reject("challengeHex required")
        val sessionId = call.getString("sessionId") ?: return call.reject("sessionId required")
        try {
            val cipher = manager.getUnsealCipher(deviceId)
            bridge.executeOnMainThread {
                showBiometricPrompt(
                    cipher = cipher,
                    subtitle = "Confirm PAK relay",
                    call = call,
                ) { authedCipher ->
                    val vaultKeyRaw = manager.unsealWithCipher(deviceId, authedCipher)
                    val result = manager.encryptForRelayWithKey(deviceId, vaultKeyRaw, remotePublicKeySpki, challengeHex, sessionId)
                    call.resolve(JSObject().apply {
                        put("ciphertext", result.ciphertext)
                        put("iv", result.iv)
                        put("phoneEphemeralPub", result.phoneEphemeralPub)
                    })
                }
            }
        } catch (e: Exception) {
            call.reject(e.message ?: "encryptForRelay failed", e)
        }
    }

    @PluginMethod
    fun sign(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: return call.reject("deviceId required")
        val dataBase64 = call.getString("dataBase64") ?: return call.reject("dataBase64 required")
        try {
            val sig = manager.sign(deviceId, dataBase64)
            call.resolve(JSObject().apply { put("signatureBase64", sig) })
        } catch (e: Exception) {
            call.reject(e.message ?: "sign failed", e)
        }
    }

    @PluginMethod
    fun hasKeys(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: return call.reject("deviceId required")
        try {
            val exists = manager.hasKeys(deviceId)
            call.resolve(JSObject().apply { put("exists", exists) })
        } catch (e: Exception) {
            call.reject(e.message ?: "hasKeys failed", e)
        }
    }

    @PluginMethod
    fun hasRawKey(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: return call.reject("deviceId required")
        try {
            val exists = manager.hasRawKey(deviceId)
            call.resolve(JSObject().apply { put("exists", exists) })
        } catch (e: Exception) {
            call.reject(e.message ?: "hasRawKey failed", e)
        }
    }

    @PluginMethod
    fun deleteKeys(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: return call.reject("deviceId required")
        try {
            manager.deleteKeys(deviceId)
            call.resolve()
        } catch (e: Exception) {
            call.reject(e.message ?: "deleteKeys failed", e)
        }
    }

    // --- BiometricPrompt helper ---

    private fun showBiometricPrompt(
        cipher: Cipher,
        subtitle: String,
        call: PluginCall,
        onSuccess: (Cipher) -> Unit,
    ) {
        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Adyton")
            .setSubtitle(subtitle)
            .setNegativeButtonText("Cancel")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .build()

        val executor = ContextCompat.getMainExecutor(context)
        val prompt = BiometricPrompt(
            activity,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    try {
                        val authedCipher = result.cryptoObject?.cipher
                            ?: return call.reject("Biometric succeeded but no cipher in result")
                        onSuccess(authedCipher)
                    } catch (e: Exception) {
                        call.reject(e.message ?: "Crypto operation failed after biometric auth", e)
                    }
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    // Map Android BiometricPrompt integer codes to the string codes that
                    // useBiometricUnlock.ts checks in its CANCEL_CODES set.
                    val code = when (errorCode) {
                        BiometricPrompt.ERROR_USER_CANCELED,
                        BiometricPrompt.ERROR_CANCELED,
                        BiometricPrompt.ERROR_NEGATIVE_BUTTON -> "userCancel"
                        BiometricPrompt.ERROR_LOCKOUT,
                        BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> "biometryLockout"
                        BiometricPrompt.ERROR_NO_BIOMETRICS,
                        BiometricPrompt.ERROR_HW_NOT_PRESENT,
                        BiometricPrompt.ERROR_HW_UNAVAILABLE -> "biometryNotAvailable"
                        else -> "systemCancel"
                    }
                    call.reject(errString.toString(), code)
                }

                override fun onAuthenticationFailed() {
                    // Prompt shows retry UI automatically — no action needed here.
                }
            }
        )
        prompt.authenticate(promptInfo, BiometricPrompt.CryptoObject(cipher))
    }
}
