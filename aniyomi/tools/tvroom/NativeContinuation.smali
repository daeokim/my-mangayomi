.class public final Ldtoon_TvRoomContinuation;
.super Ljava/lang/Object;
.implements Lkotlin/coroutines/Continuation;
.field private final callback:Ldaeo/tvroom/TvRoomDomain$Callback;
.field private final parent:Lkotlin/coroutines/Continuation;
.method public constructor <init>(Ldaeo/tvroom/TvRoomDomain$Callback;Lkotlin/coroutines/Continuation;)V
    .locals 0
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    iput-object p1, p0, Ldtoon_TvRoomContinuation;->callback:Ldaeo/tvroom/TvRoomDomain$Callback;
    iput-object p2, p0, Ldtoon_TvRoomContinuation;->parent:Lkotlin/coroutines/Continuation;
    return-void
.end method
.method public getContext()Lkotlin/coroutines/CoroutineContext;
    .locals 1
    iget-object v0, p0, Ldtoon_TvRoomContinuation;->parent:Lkotlin/coroutines/Continuation;
    invoke-interface {v0}, Lkotlin/coroutines/Continuation;->getContext()Lkotlin/coroutines/CoroutineContext;
    move-result-object v0
    return-object v0
.end method
.method public resumeWith(Ljava/lang/Object;)V
    .locals 2
    iget-object v0, p0, Ldtoon_TvRoomContinuation;->callback:Ldaeo/tvroom/TvRoomDomain$Callback;
    # The host app's kotlin.Result boxes failures (timeout, cancellation) as Result$Failure; the extension's
    # obfuscated Result helper does not know that class, so unwrap it here instead of casting it to byte[].
    instance-of v1, p1, Lkotlin/Result$Failure;
    if-eqz v1, :value
    check-cast p1, Lkotlin/Result$Failure;
    iget-object v1, p1, Lkotlin/Result$Failure;->exception:Ljava/lang/Throwable;
    goto :error
    :value
    instance-of v1, p1, [B
    if-eqz v1, :unexpected
    check-cast p1, [B
    invoke-interface {v0, p1}, Ldaeo/tvroom/TvRoomDomain$Callback;->success([B)V
    return-void
    :unexpected
    new-instance v1, Ljava/lang/IllegalStateException;
    const-string p1, "TVRoom request returned no body"
    invoke-direct {v1, p1}, Ljava/lang/IllegalStateException;-><init>(Ljava/lang/String;)V
    :error
    invoke-interface {v0, v1}, Ldaeo/tvroom/TvRoomDomain$Callback;->error(Ljava/lang/Throwable;)V
    return-void
.end method
