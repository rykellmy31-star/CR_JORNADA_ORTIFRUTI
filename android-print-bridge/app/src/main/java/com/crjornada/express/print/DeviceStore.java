package com.crjornada.express.print;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.HashSet;
import java.util.Set;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Não salva o token do Android em texto puro e nunca registra tokens em logs. */
public final class DeviceStore {
 private static final String FILE="crx_print_bridge";
 private static final String KEY_ALIAS="crx_print_device_key_v1";
 private final SharedPreferences prefs;
 public DeviceStore(Context context){prefs=context.getSharedPreferences(FILE,Context.MODE_PRIVATE);}
 private SecretKey key() throws Exception {
  KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
  if(store.containsAlias(KEY_ALIAS))return (SecretKey)store.getKey(KEY_ALIAS,null);
  KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
  generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
   KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
   .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
   .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
  return generator.generateKey();
 }
 private String encrypt(String plaintext) throws Exception {
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
  cipher.init(Cipher.ENCRYPT_MODE,key());
  byte[] iv=cipher.getIV(),encrypted=cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
  byte[] output=new byte[iv.length+encrypted.length];
  System.arraycopy(iv,0,output,0,iv.length);
  System.arraycopy(encrypted,0,output,iv.length,encrypted.length);
  return Base64.encodeToString(output,Base64.NO_WRAP);
 }
 private String decrypt(String value) throws Exception {
  byte[] input=Base64.decode(value,Base64.NO_WRAP);
  byte[] iv=new byte[12],ciphertext=new byte[input.length-12];
  System.arraycopy(input,0,iv,0,12);
  System.arraycopy(input,12,ciphertext,0,ciphertext.length);
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
  cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,iv));
  return new String(cipher.doFinal(ciphertext),StandardCharsets.UTF_8);
 }
 public synchronized void pair(String slug,String deviceId,String deviceToken,String storeName) throws Exception {
  String encrypted=encrypt(deviceToken);
  prefs.edit().putString("token",encrypted).putString("slug",slug)
   .putString("device_id",deviceId).putString("store_name",storeName)
   .remove("printed_jobs").commit();
 }
 public synchronized String token(){
  try{String encrypted=prefs.getString("token","");return encrypted.isEmpty()?"":decrypt(encrypted);}
  catch(Exception ex){return "";}
 }
 public String slug(){return prefs.getString("slug","");}
 public String storeName(){return prefs.getString("store_name","");}
 public String deviceId(){return prefs.getString("device_id","");}
 public String printerAddress(){return prefs.getString("printer_address","");}
 public void setPrinterAddress(String value){prefs.edit().putString("printer_address",value).apply();}
 public void setStatus(String value){prefs.edit().putString("status",value).apply();}
 public boolean shouldResumePrinting(){return prefs.getBoolean("printing_enabled",false);}
 public void setShouldResumePrinting(boolean value){prefs.edit().putBoolean("printing_enabled",value).apply();}
 public long lastUpdateCheckedAt(){return prefs.getLong("last_update_checked_at",0L);}
 public void markUpdateChecked(){prefs.edit().putLong("last_update_checked_at",System.currentTimeMillis()).apply();}

 public String status(){return prefs.getString("status","Parado");}
 public synchronized void unpair(){
  prefs.edit().remove("token").remove("device_id").remove("slug")
   .remove("store_name").remove("printed_jobs").commit();
 }
 public synchronized boolean alreadyPrinted(String jobId){
  return prefs.getStringSet("printed_jobs",new HashSet<>()).contains(jobId);
 }
 public synchronized void markPrinted(String jobId){
  Set<String> printed=new HashSet<>(prefs.getStringSet("printed_jobs",new HashSet<>()));
  printed.add(jobId);
  // Limita o armazenamento local; no servidor também existe estado de impressão.
  if(printed.size()>400){printed.clear();printed.add(jobId);}
  if(!prefs.edit().putStringSet("printed_jobs",printed).commit())
   throw new IllegalStateException("Não foi possível registrar a impressão localmente.");
 }
}
