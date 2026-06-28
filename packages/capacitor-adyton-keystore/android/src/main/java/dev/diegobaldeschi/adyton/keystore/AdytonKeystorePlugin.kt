package dev.diegobaldeschi.adyton.keystore

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

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

    @PluginMethod
    fun sealVaultKey(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: return call.reject("deviceId required")
        val vaultKeyRaw = call.getString("vaultKeyRaw") ?: return call.reject("vaultKeyRaw required")
        try {
            manager.sealVaultKey(deviceId, vaultKeyRaw)
            call.resolve()
        } catch (e: Exception) {
            call.reject(e.message ?: "sealVaultKey failed", e)
        }
    }

    @PluginMethod
    fun unsealVaultKey(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: return call.reject("deviceId required")
        try {
            val raw = manager.unsealVaultKey(deviceId)
            call.resolve(JSObject().apply { put("vaultKeyRaw", raw) })
        } catch (e: Exception) {
            call.reject(e.message ?: "unsealVaultKey failed", e)
        }
    }

    @PluginMethod
    fun encryptForRelay(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: return call.reject("deviceId required")
        val remotePublicKeySpki = call.getString("remotePublicKeySpki") ?: return call.reject("remotePublicKeySpki required")
        val challengeHex = call.getString("challengeHex") ?: return call.reject("challengeHex required")
        val sessionId = call.getString("sessionId") ?: return call.reject("sessionId required")
        try {
            val result = manager.encryptForRelay(deviceId, remotePublicKeySpki, challengeHex, sessionId)
            call.resolve(JSObject().apply {
                put("ciphertext", result.ciphertext)
                put("iv", result.iv)
                put("phoneEphemeralPub", result.phoneEphemeralPub)
            })
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
    fun deleteKeys(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: return call.reject("deviceId required")
        try {
            manager.deleteKeys(deviceId)
            call.resolve()
        } catch (e: Exception) {
            call.reject(e.message ?: "deleteKeys failed", e)
        }
    }
}
