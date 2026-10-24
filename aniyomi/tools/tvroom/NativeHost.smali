.class public final Ldtoon_TvRoomHost;
.super Ljava/lang/Object;
.implements Ldaeo/tvroom/TvRoomDomain$Host;
.field private final source:Lqb;
.field private final parent:Lkotlin/coroutines/Continuation;

.method public constructor <init>(Lqb;Lkotlin/coroutines/Continuation;)V
    .locals 1
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    iput-object p1, p0, Ldtoon_TvRoomHost;->source:Lqb;
    if-eqz p2, :store
    new-instance v0, Lkotlin/coroutines/SafeContinuation;
    invoke-direct {v0, p2}, Lkotlin/coroutines/SafeContinuation;-><init>(Lkotlin/coroutines/Continuation;)V
    move-object p2, v0
    :store
    iput-object p2, p0, Ldtoon_TvRoomHost;->parent:Lkotlin/coroutines/Continuation;
    return-void
.end method

.method public awaitResult()Ljava/lang/Object;
    .locals 1
    iget-object v0, p0, Ldtoon_TvRoomHost;->parent:Lkotlin/coroutines/Continuation;
    check-cast v0, Lkotlin/coroutines/SafeContinuation;
    invoke-virtual {v0}, Lkotlin/coroutines/SafeContinuation;->getOrThrow()Ljava/lang/Object;
    move-result-object v0
    return-object v0
.end method

.method public read()Ljava/lang/String;
    .locals 3
    iget-object v0, p0, Ldtoon_TvRoomHost;->source:Lqb;
    invoke-virtual {v0}, Lqb;->daeoPrefs()Landroid/content/SharedPreferences;
    move-result-object v0
    const-string v1, "auto_domain"
    const-string v2, ""
    invoke-interface {v0, v1, v2}, Landroid/content/SharedPreferences;->getString(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;
    move-result-object v0
    return-object v0
.end method

.method public write(Ljava/lang/String;)Z
    .locals 2
    iget-object v0, p0, Ldtoon_TvRoomHost;->source:Lqb;
    invoke-virtual {v0}, Lqb;->daeoPrefs()Landroid/content/SharedPreferences;
    move-result-object v0
    invoke-interface {v0}, Landroid/content/SharedPreferences;->edit()Landroid/content/SharedPreferences$Editor;
    move-result-object v0
    const-string v1, "auto_domain"
    invoke-interface {v0, v1, p1}, Landroid/content/SharedPreferences$Editor;->putString(Ljava/lang/String;Ljava/lang/String;)Landroid/content/SharedPreferences$Editor;
    move-result-object v0
    invoke-interface {v0}, Landroid/content/SharedPreferences$Editor;->commit()Z
    move-result v0
    return v0
.end method

.method public changed(Ljava/lang/String;)V
    .locals 0
    invoke-static {p1}, Lqb;->daeoBase(Ljava/lang/String;)V
    return-void
.end method

.method public active()Z
    .locals 2
    iget-object v0, p0, Ldtoon_TvRoomHost;->parent:Lkotlin/coroutines/Continuation;
    if-eqz v0, :active
    invoke-interface {v0}, Lkotlin/coroutines/Continuation;->getContext()Lkotlin/coroutines/CoroutineContext;
    move-result-object v0
    sget-object v1, Lkotlinx/coroutines/Job;->Key:Lkotlinx/coroutines/Job$Key;
    invoke-interface {v0, v1}, Lkotlin/coroutines/CoroutineContext;->get(Lkotlin/coroutines/CoroutineContext$Key;)Lkotlin/coroutines/CoroutineContext$Element;
    move-result-object v0
    if-eqz v0, :active
    check-cast v0, Lkotlinx/coroutines/Job;
    invoke-interface {v0}, Lkotlinx/coroutines/Job;->isActive()Z
    move-result v0
    return v0
    :active
    const/4 v0, 0x1
    return v0
.end method

.method public suspended()Ljava/lang/Object;
    .locals 1
    invoke-static {}, Lkotlin/coroutines/intrinsics/IntrinsicsKt;->getCOROUTINE_SUSPENDED()Ljava/lang/Object;
    move-result-object v0
    return-object v0
.end method

.method public complete(Ljava/lang/String;Ljava/lang/Throwable;)V
    .locals 1
    if-eqz p2, :resume
    invoke-static {p2}, Lgm;->a(Ljava/lang/Throwable;)Ljava/lang/Object;
    move-result-object p1
    :resume
    iget-object v0, p0, Ldtoon_TvRoomHost;->parent:Lkotlin/coroutines/Continuation;
    invoke-interface {v0, p1}, Lkotlin/coroutines/Continuation;->resumeWith(Ljava/lang/Object;)V
    return-void
.end method

.method public raw(Ljava/lang/String;Ljava/util/Map;ILdaeo/tvroom/TvRoomDomain$Callback;)V
    .locals 6
    new-instance v0, Ldtoon_TvRoomContinuation;
    iget-object v1, p0, Ldtoon_TvRoomHost;->parent:Lkotlin/coroutines/Continuation;
    invoke-direct {v0, p4, v1}, Ldtoon_TvRoomContinuation;-><init>(Ldaeo/tvroom/TvRoomDomain$Callback;Lkotlin/coroutines/Continuation;)V
    :try_start
    new-instance v1, Ldtoon_TvRoomFetch;
    iget-object v2, p0, Ldtoon_TvRoomHost;->source:Lqb;
    const/4 v3, 0x0
    invoke-direct {v1, v2, p1, p2, v3}, Ldtoon_TvRoomFetch;-><init>(Lqb;Ljava/lang/String;Ljava/util/Map;Lkotlin/coroutines/Continuation;)V
    int-to-long v2, p3
    invoke-static {v2, v3, v1, v0}, Lkotlinx/coroutines/TimeoutKt;->withTimeout(JLkotlin/jvm/functions/Function2;Lkotlin/coroutines/Continuation;)Ljava/lang/Object;
    move-result-object v1
    invoke-static {}, Lkotlin/coroutines/intrinsics/IntrinsicsKt;->getCOROUTINE_SUSPENDED()Ljava/lang/Object;
    move-result-object v2
    if-eq v1, v2, :done
    invoke-virtual {v0, v1}, Ldtoon_TvRoomContinuation;->resumeWith(Ljava/lang/Object;)V
    :try_end
    .catch Ljava/lang/Throwable; {:try_start .. :try_end} :error
    :done
    return-void
    :error
    move-exception v0
    invoke-interface {p4, v0}, Ldaeo/tvroom/TvRoomDomain$Callback;->error(Ljava/lang/Throwable;)V
    return-void
.end method
