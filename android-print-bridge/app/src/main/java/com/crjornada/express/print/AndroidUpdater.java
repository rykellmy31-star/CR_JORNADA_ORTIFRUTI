package com.crjornada.express.print;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;

/** Canal OTA do próprio Express: consulta, baixa e verifica antes de abrir o instalador do Android. */
public final class AndroidUpdater {
 private static final String UPDATE_ENDPOINT =
  BackendClient.BASE+"/api/printing/android-update";
 private static final String ASSET_NAME="cr-jornada-express-impressao.apk";
 private static final String REPO="rykellmy31-star/CR_JORNADA_ORTIFRUTI";
 private static final long MAX_APK_BYTES=50L*1024*1024;
 private AndroidUpdater(){}

 public static final class Update {
  public final int versionCode;
  public final String versionName,downloadUrl,sha256;
  public final long sizeBytes;
  Update(int code,String name,String url,String sha,long size){
   versionCode=code;versionName=name;downloadUrl=url;sha256=sha;sizeBytes=size;
  }
 }

 public static int installedCode(Activity activity) throws Exception {
  PackageInfo p=activity.getPackageManager().getPackageInfo(activity.getPackageName(),0);
  return Build.VERSION.SDK_INT>=28?(int)p.getLongVersionCode():p.versionCode;
 }
 public static String installedVersion(Activity activity) throws Exception {
  PackageInfo p=activity.getPackageManager().getPackageInfo(activity.getPackageName(),0);
  return p.versionName==null?"versão desconhecida":p.versionName;
 }

 private static boolean allowedReleaseUrl(URL url,int code){
  if(!"https".equalsIgnoreCase(url.getProtocol())||
   !"github.com".equalsIgnoreCase(url.getHost()))return false;
  String expected="/"+REPO+"/releases/download/cr-express-print-v"+code+"/"+ASSET_NAME;
  return expected.equals(url.getPath())&&url.getQuery()==null;
 }
 private static boolean allowedRedirect(URL url){
  if(!"https".equalsIgnoreCase(url.getProtocol()))return false;
  String host=url.getHost().toLowerCase(Locale.ROOT);
  return "github.com".equals(host)||"release-assets.githubusercontent.com".equals(host)
    ||"objects.githubusercontent.com".equals(host);
 }
 private static String readJson(InputStream in) throws IOException{
  try(InputStream source=in;ByteArrayOutputStream out=new ByteArrayOutputStream()){
   byte[] chunk=new byte[4096];int n;
   while((n=source.read(chunk))!=-1){
    out.write(chunk,0,n);
    if(out.size()>16384)throw new IOException("Resposta de atualização muito grande.");
   }
   return out.toString(StandardCharsets.UTF_8.name());
  }
 }
 public static Update check() throws Exception{
  URL url=new URL(UPDATE_ENDPOINT);
  HttpURLConnection conn=(HttpURLConnection)url.openConnection();
  conn.setConnectTimeout(9000);conn.setReadTimeout(15000);
  conn.setRequestProperty("Accept","application/json");
  conn.setUseCaches(false);
  try{
   int status=conn.getResponseCode();
   if(status!=200)throw new IOException("Serviço de atualização indisponível (HTTP "+status+").");
   JSONObject data=new JSONObject(readJson(conn.getInputStream()));
   if(!data.optBoolean("available",false))return null;
   int code=data.getInt("versionCode");
   long size=data.getLong("sizeBytes");
   String sha=data.getString("sha256").toLowerCase(Locale.ROOT);
   String apk=data.getString("apkUrl");
   if(code<=1||size<1024||size>MAX_APK_BYTES||!sha.matches("[0-9a-f]{64}")||
    !allowedReleaseUrl(new URL(apk),code))
    throw new IOException("Metadados de atualização inválidos.");
   return new Update(code,data.optString("versionName","1.0."+code),apk,sha,size);
  }finally{conn.disconnect();}
 }

 private static HttpURLConnection connectAsset(URL first) throws Exception{
  URL url=first;
  for(int redirects=0;redirects<6;redirects++){
   if(!allowedRedirect(url))throw new IOException("Fonte da atualização não autorizada.");
   HttpURLConnection conn=(HttpURLConnection)url.openConnection();
   conn.setInstanceFollowRedirects(false);
   conn.setConnectTimeout(12000);conn.setReadTimeout(30000);
   conn.setRequestProperty("Accept","application/octet-stream");
   conn.setRequestProperty("User-Agent","CR-Jornada-Express-Android");
   int status=conn.getResponseCode();
   if(status==301||status==302||status==303||status==307||status==308){
    String location=conn.getHeaderField("Location");conn.disconnect();
    if(location==null)throw new IOException("Redirecionamento sem destino.");
    url=new URL(url,location);continue;
   }
   if(status!=200){conn.disconnect();throw new IOException("Download indisponível (HTTP "+status+").");}
   return conn;
  }
  throw new IOException("Muitos redirecionamentos na atualização.");
 }

 private static Signature[] signatures(PackageInfo pkg){
  if(pkg==null)return null;
  if(Build.VERSION.SDK_INT>=28){
   return pkg.signingInfo==null?null:pkg.signingInfo.getApkContentsSigners();
  }
  return pkg.signatures;
 }
 private static void verifyApkPackage(Activity activity,File file,Update update) throws Exception{
  PackageManager manager=activity.getPackageManager();
  int flag=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
  PackageInfo candidate=manager.getPackageArchiveInfo(file.getAbsolutePath(),flag);
  PackageInfo installed=manager.getPackageInfo(activity.getPackageName(),flag);
  if(candidate==null||!activity.getPackageName().equals(candidate.packageName))
   throw new IOException("O pacote baixado não pertence ao CR Jornada Express.");
  long newVersion=Build.VERSION.SDK_INT>=28?candidate.getLongVersionCode():candidate.versionCode;
  if(newVersion!=update.versionCode||newVersion<=installedCode(activity))
   throw new IOException("A versão do APK não corresponde à atualização anunciada.");
  Signature[] a=signatures(candidate),b=signatures(installed);
  if(a==null||b==null||a.length!=b.length||a.length==0)
   throw new IOException("Assinatura do APK não pôde ser verificada.");
  for(int i=0;i<a.length;i++){
   if(!MessageDigest.isEqual(a[i].toByteArray(),b[i].toByteArray())){
    throw new IOException("A nova versão tem assinatura diferente desta instalação. "+
     "A migração inicial do APK beta antigo exige uma instalação única da versão assinada.");
   }
  }
 }

 public static File downloadAndVerify(Activity activity,Update update) throws Exception{
  URL first=new URL(update.downloadUrl);
  if(!allowedReleaseUrl(first,update.versionCode))
   throw new IOException("Download da atualização bloqueado.");
  File folder=new File(activity.getCacheDir(),"updates");
  if(!folder.isDirectory()&&!folder.mkdirs())throw new IOException("Não foi possível preparar a pasta de atualização.");
  File destination=new File(folder,"cr-jornada-update.apk");
  if(destination.exists())destination.delete();
  HttpURLConnection conn=connectAsset(first);
  try{
   long size=conn.getContentLengthLong();
   if(size>MAX_APK_BYTES)throw new IOException("APK excede o tamanho permitido.");
   MessageDigest digest=MessageDigest.getInstance("SHA-256");
   long total=0;
   try(InputStream source=conn.getInputStream();FileOutputStream output=new FileOutputStream(destination)){
    byte[] chunk=new byte[8192];int read;
    while((read=source.read(chunk))!=-1){
     total+=read;
     if(total>MAX_APK_BYTES)throw new IOException("Arquivo de atualização muito grande.");
     output.write(chunk,0,read);digest.update(chunk,0,read);
    }
   }
   StringBuilder hash=new StringBuilder();
   for(byte x:digest.digest())hash.append(String.format(Locale.ROOT,"%02x",x&0xff));
   if(total!=update.sizeBytes||!update.sha256.equals(hash.toString()))
    throw new IOException("O arquivo baixado não passou na verificação de integridade.");
   verifyApkPackage(activity,destination,update);
   return destination;
  }catch(Exception ex){destination.delete();throw ex;}
  finally{conn.disconnect();}
 }

 /** Instalação de APK exige confirmação do usuário: não existe atualização silenciosa livre no Android. */
 public static boolean requestInstall(Activity activity,File verifiedApk){
  if(Build.VERSION.SDK_INT>=26&&!activity.getPackageManager().canRequestPackageInstalls()){
   Intent allow=new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
    Uri.parse("package:"+activity.getPackageName()));
   activity.startActivity(allow);
   return false;
  }
  Uri uri=FileProvider.getUriForFile(activity,
   activity.getPackageName()+".updatefiles",verifiedApk);
  Intent intent=new Intent(Intent.ACTION_VIEW);
  intent.setDataAndType(uri,"application/vnd.android.package-archive");
  intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
  activity.startActivity(intent);
  return true;
 }
}
