package com.crjornada.express.print;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class BackendClient {
 // URL técnica legada preservada para não alterar domínios existentes.
 public static final String BASE="https://hortifruti.crjornada.com";
 private static final String ROOT="/api/printing/device";

 private static final class Result{
  final int status;final JSONObject data;
  Result(int status,JSONObject data){this.status=status;this.data=data;}
 }
 private static byte[] read(InputStream in) throws IOException {
  if(in==null)return new byte[0];
  try(InputStream source=in;ByteArrayOutputStream out=new ByteArrayOutputStream()){
   byte[] chunk=new byte[4096];int n;
   while((n=source.read(chunk))!=-1)out.write(chunk,0,n);
   return out.toByteArray();
  }
 }
 private Result request(String method,String path,JSONObject body,String token) throws Exception{
  URL url=new URL(BASE+ROOT+path);
  HttpURLConnection conn=(HttpURLConnection)url.openConnection();
  conn.setInstanceFollowRedirects(false);
  conn.setConnectTimeout(8000);conn.setReadTimeout(12000);
  conn.setRequestMethod(method);
  conn.setRequestProperty("Accept","application/json");
  conn.setRequestProperty("Cache-Control","no-store");
  if(token!=null&&!token.isEmpty())conn.setRequestProperty("Authorization","Bearer "+token);
  if(body!=null){
   conn.setDoOutput(true);
   conn.setRequestProperty("Content-Type","application/json; charset=utf-8");
   byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);
   try(OutputStream out=conn.getOutputStream()){out.write(bytes);}
  }
  try{
   int status=conn.getResponseCode();
   if(status==204)return new Result(status,new JSONObject());
   byte[] bytes=read(status>=400?conn.getErrorStream():conn.getInputStream());
   String raw=new String(bytes,StandardCharsets.UTF_8);
   JSONObject data=raw.isEmpty()?new JSONObject():new JSONObject(raw);
   if(status<200||status>=300){
    String message=data.optString("error","Servidor retornou HTTP "+status);
    throw new IOException("HTTP "+status+": "+message);
   }
   return new Result(status,data);
  }finally{conn.disconnect();}
 }
 public JSONObject pair(String slug,String code,String name) throws Exception{
  JSONObject data=new JSONObject().put("tenantSlug",slug).put("code",code).put("deviceName",name);
  return request("POST","/pair",data,null).data;
 }
 public JSONObject status(String token) throws Exception{
  return request("GET","/status",null,token).data;
 }
 public JSONObject claim(String token) throws Exception{
  Result res=request("POST","/jobs/claim",new JSONObject(),token);
  return res.status==204?null:res.data.optJSONObject("job");
 }
 public JSONObject ack(String token,String id,String leaseToken,boolean success,String error) throws Exception{
  if(!id.matches("[a-fA-F0-9-]{30,50}"))throw new IOException("Identificador de comanda inválido.");
  JSONObject body=new JSONObject().put("leaseToken",leaseToken).put("success",success);
  if(error!=null)body.put("error",error.length()>180?error.substring(0,180):error);
  return request("POST","/jobs/"+id+"/ack",body,token).data;
 }
}
