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
    invoke-static {p1}, Lfm;->d(Ljava/lang/Object;)Ljava/lang/Throwable;
    move-result-object v1
    if-nez v1, :error
    check-cast p1, [B
    invoke-interface {v0, p1}, Ldaeo/tvroom/TvRoomDomain$Callback;->success([B)V
    return-void
    :error
    invoke-interface {v0, v1}, Ldaeo/tvroom/TvRoomDomain$Callback;->error(Ljava/lang/Throwable;)V
    return-void
.end method
