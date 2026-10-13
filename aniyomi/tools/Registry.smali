.class public final Ldaeo/Registry;
.super Ljava/lang/Object;

.field private static volatile data:Lorg/json/JSONObject;
.field private static volatile nextCheck:J
.field private static final known:Ljava/util/Map;

.method static constructor <clinit>()V
    .locals 1
    new-instance v0, Ljava/util/concurrent/ConcurrentHashMap;
    invoke-direct {v0}, Ljava/util/concurrent/ConcurrentHashMap;-><init>()V
    sput-object v0, Ldaeo/Registry;->known:Ljava/util/Map;
    return-void
.end method

# No network calls from Android's main thread. An invalid/missing result lets
# the original engine use its own default, number preferences and fallback.
.method public static resolve(Ljava/lang/String;)Ljava/lang/String;
    .locals 5
    sget-object v0, Ldaeo/Registry;->known:Ljava/util/Map;
    invoke-interface {v0, p0}, Ljava/util/Map;->get(Ljava/lang/Object;)Ljava/lang/Object;
    move-result-object v0
    check-cast v0, Ljava/lang/String;
    invoke-static {}, Landroid/os/Looper;->myLooper()Landroid/os/Looper;
    move-result-object v1
    invoke-static {}, Landroid/os/Looper;->getMainLooper()Landroid/os/Looper;
    move-result-object v2
    if-eq v1, v2, :fallback
    :try_start
    invoke-static {}, Ldaeo/Registry;->refresh()Lorg/json/JSONObject;
    move-result-object v1
    const-string v2, "domains"
    invoke-virtual {v1, v2}, Lorg/json/JSONObject;->getJSONObject(Ljava/lang/String;)Lorg/json/JSONObject;
    move-result-object v1
    invoke-virtual {v1, p0}, Lorg/json/JSONObject;->getJSONObject(Ljava/lang/String;)Lorg/json/JSONObject;
    move-result-object v1
    const-string v2, "baseUrl"
    invoke-virtual {v1, v2}, Lorg/json/JSONObject;->getString(Ljava/lang/String;)Ljava/lang/String;
    move-result-object v1
    const-string v2, "11toon"
    invoke-virtual {p0, v2}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
    move-result v2
    if-eqz v2, :goodtoon
    const-string v2, "^https://(?:www\\.)?11toon(\\d*)\\.com/?$"
    const/4 v3, 0
    goto :validate
    :goodtoon
    const-string v2, "goodtoon"
    invoke-virtual {p0, v2}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
    move-result v2
    if-eqz v2, :fallback
    const-string v2, "^https://(?:www\\.)?goodtoon(\\d+)\\.com/?$"
    const/4 v3, 7
    :validate
    invoke-static {v2}, Ljava/util/regex/Pattern;->compile(Ljava/lang/String;)Ljava/util/regex/Pattern;
    move-result-object v2
    invoke-virtual {v2, v1}, Ljava/util/regex/Pattern;->matcher(Ljava/lang/CharSequence;)Ljava/util/regex/Matcher;
    move-result-object v2
    invoke-virtual {v2}, Ljava/util/regex/Matcher;->matches()Z
    move-result v4
    if-eqz v4, :fallback
    if-eqz v3, :accept
    const/4 v4, 1
    invoke-virtual {v2, v4}, Ljava/util/regex/Matcher;->group(I)Ljava/lang/String;
    move-result-object v2
    invoke-static {v2}, Ljava/lang/Integer;->parseInt(Ljava/lang/String;)I
    move-result v2
    if-lt v2, v3, :fallback
    :accept
    sget-object v2, Ldaeo/Registry;->known:Ljava/util/Map;
    invoke-interface {v2, p0, v1}, Ljava/util/Map;->put(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;
    return-object v1
    :try_end
    .catch Ljava/lang/Exception; {:try_start .. :try_end} :failure
    :failure
    move-exception v1
    :fallback
    return-object v0
.end method

.method private static refresh()Lorg/json/JSONObject;
    .locals 10
    invoke-static {}, Ljava/lang/System;->currentTimeMillis()J
    move-result-wide v0
    sget-wide v2, Ldaeo/Registry;->nextCheck:J
    cmp-long v2, v0, v2
    if-ltz v2, :cached
    # Retry failed registry requests after one minute; successes cache five.
    const-wide/32 v2, 60000
    add-long/2addr v2, v0
    sput-wide v2, Ldaeo/Registry;->nextCheck:J
    const/4 v4, 0
    :try_start
    new-instance v2, Ljava/net/URL;
    const-string v3, "https://daeokim.github.io/my-mangayomi/domains.json"
    invoke-direct {v2, v3}, Ljava/net/URL;-><init>(Ljava/lang/String;)V
    invoke-virtual {v2}, Ljava/net/URL;->openConnection()Ljava/net/URLConnection;
    move-result-object v2
    check-cast v2, Ljava/net/HttpURLConnection;
    move-object v4, v2
    const/16 v3, 5000
    invoke-virtual {v4, v3}, Ljava/net/URLConnection;->setConnectTimeout(I)V
    invoke-virtual {v4, v3}, Ljava/net/URLConnection;->setReadTimeout(I)V
    const/4 v3, 0
    invoke-virtual {v4, v3}, Ljava/net/HttpURLConnection;->setInstanceFollowRedirects(Z)V
    invoke-virtual {v4, v3}, Ljava/net/URLConnection;->setUseCaches(Z)V
    const-string v2, "Accept"
    const-string v3, "application/json"
    invoke-virtual {v4, v2, v3}, Ljava/net/URLConnection;->setRequestProperty(Ljava/lang/String;Ljava/lang/String;)V
    invoke-virtual {v4}, Ljava/net/HttpURLConnection;->getResponseCode()I
    move-result v2
    const/16 v3, 200
    if-ne v2, v3, :disconnect
    invoke-virtual {v4}, Ljava/net/URLConnection;->getInputStream()Ljava/io/InputStream;
    move-result-object v5
    new-instance v6, Ljava/io/ByteArrayOutputStream;
    invoke-direct {v6}, Ljava/io/ByteArrayOutputStream;-><init>()V
    const/16 v2, 1024
    new-array v7, v2, [B
    :read
    invoke-static {}, Ljava/lang/System;->currentTimeMillis()J
    move-result-wide v2
    sub-long/2addr v2, v0
    const-wide/32 v8, 10000
    cmp-long v2, v2, v8
    if-gtz v2, :too_large
    invoke-virtual {v5, v7}, Ljava/io/InputStream;->read([B)I
    move-result v8
    if-ltz v8, :parse
    invoke-virtual {v6}, Ljava/io/ByteArrayOutputStream;->size()I
    move-result v2
    add-int/2addr v2, v8
    const v3, 65536
    if-gt v2, v3, :too_large
    const/4 v2, 0
    invoke-virtual {v6, v7, v2, v8}, Ljava/io/ByteArrayOutputStream;->write([BII)V
    goto :read
    :too_large
    invoke-virtual {v5}, Ljava/io/InputStream;->close()V
    goto :disconnect
    :parse
    invoke-virtual {v5}, Ljava/io/InputStream;->close()V
    const-string v2, "UTF-8"
    invoke-virtual {v6, v2}, Ljava/io/ByteArrayOutputStream;->toString(Ljava/lang/String;)Ljava/lang/String;
    move-result-object v2
    new-instance v3, Lorg/json/JSONObject;
    invoke-direct {v3, v2}, Lorg/json/JSONObject;-><init>(Ljava/lang/String;)V
    const-string v2, "domains"
    invoke-virtual {v3, v2}, Lorg/json/JSONObject;->getJSONObject(Ljava/lang/String;)Lorg/json/JSONObject;
    sput-object v3, Ldaeo/Registry;->data:Lorg/json/JSONObject;
    const-wide/32 v2, 300000
    add-long/2addr v0, v2
    sput-wide v0, Ldaeo/Registry;->nextCheck:J
    :disconnect
    invoke-virtual {v4}, Ljava/net/HttpURLConnection;->disconnect()V
    :try_end
    .catch Ljava/lang/Exception; {:try_start .. :try_end} :error
    goto :cached
    :error
    move-exception v2
    if-eqz v4, :cached
    invoke-virtual {v4}, Ljava/net/HttpURLConnection;->disconnect()V
    :cached
    sget-object v0, Ldaeo/Registry;->data:Lorg/json/JSONObject;
    return-object v0
.end method
