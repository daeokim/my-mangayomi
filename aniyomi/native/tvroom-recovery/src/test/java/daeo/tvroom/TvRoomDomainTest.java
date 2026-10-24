package daeo.tvroom;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.*;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CancellationException;

public class TvRoomDomainTest {
    static final String HTML="<title>티비룸 TVRoom</title><div class='module-item'><div class='v-item'><a class='v-item-hitarea' href='/video/work-42' aria-label='작품'></a><div class='v-item-cover'><img data-src='/cover.jpg'></div></div></div>";
    static class Fake implements TvRoomDomain.Host {
        String saved="",hint="",changed,result;Throwable failure;boolean active=true,persist=true,async;
        int writes,completions;List<String> urls=new ArrayList<>();List<Map<String,String>> headers=new ArrayList<>();
        Map<String,Object> replies=new HashMap<>();List<Runnable> pending=new ArrayList<>();final Object suspended=new Object();
        public String read(){return saved;}
        public boolean write(String s){if(!persist)return false;saved=s;writes++;return true;}
        public void changed(String s){changed=s;}
        public boolean active(){return active;}
        public Object suspended(){return suspended;}
        public void complete(String s,Throwable e){result=s;failure=e;completions++;}
        public void raw(final String url,Map<String,String> h,int timeout,final TvRoomDomain.Callback cb){
            assertTrue(timeout==4000||timeout==15000);urls.add(url);headers.add(h);
            final Object value=url.equals(TvRoomDomain.REGISTRY)?"{\"domains\":{\"tvroom\":{\"status\":\"protected\",\"baseUrl\":\""+hint+"\"}}}":replies.containsKey(url)?replies.get(url):new IOException("offline");
            Runnable r=new Runnable(){public void run(){if(value instanceof Throwable)cb.error((Throwable)value);else cb.success(value.toString().getBytes(StandardCharsets.UTF_8));}};
            if(async)pending.add(r);else r.run();
        }
        void drain(){int cap=0;while(!pending.isEmpty()){assertTrue(++cap<30);pending.remove(0).run();}}
    }
    static Map<String,String> empty(){return Collections.emptyMap();}
    @Test public void numbersAndBoundary(){
        assertEquals(Arrays.asList("https://tvroom100.org","https://tvroom101.org","https://tvroom102.org","https://tvroom103.org","https://tvroom104.org"),TvRoomDomain.candidates("https://tvroom99.org",""));
        assertTrue(TvRoomDomain.candidates("https://tvroom999999.org","").isEmpty());
        assertEquals(Arrays.asList("https://tvroom50.org","https://tvroom43.org","https://tvroom44.org","https://tvroom45.org","https://tvroom46.org","https://tvroom47.org"),TvRoomDomain.candidates("https://tvroom42.org","https://tvroom50.org"));
    }
    @Test public void originAllowlist(){
        for(String s:Arrays.asList("http://tvroom42.org","https://tvroom42.org.evil.test","https://user@tvroom42.org","https://tvroom42.org:8443","https://tvroom42.org?x=1","https://tvroom42.org/x","https://tvroom0.org","https://tvroom1000000.org"))assertEquals(s,"",TvRoomDomain.normalize(s));
        assertEquals("https://tvroom42.org",TvRoomDomain.normalize("https://tvroom42.org/"));
    }
    @Test public void actualCardsRequired(){
        assertTrue(TvRoomDomain.validCatalog(HTML,"https://tvroom42.org"));
        for(String s:Arrays.asList(HTML.replace("티비룸 TVRoom","Other"),HTML.replace("module-item","navigation"),HTML.replace("v-item-cover","other"),HTML.replace("aria-label='작품'",""),HTML.replace("/video/work-42","/video/영화"),HTML.replace("/video/work-42","https://evil.test/video/a"),"<title>티비룸</title><script>"+HTML+"</script>","<title>티비룸</title><!--"+HTML+"-->",HTML+"<div class='cf-chl-container'></div>"))assertFalse(s,TvRoomDomain.validCatalog(s,"https://tvroom42.org"));
    }
    @Test public void redirectsCannotChangeOrigin(){
        assertTrue(TvRoomDomain.allowRedirect("https://tvroom42.org/","/list"));
        for(String s:Arrays.asList("http://tvroom42.org/","https://tvroom43.org/","https://evil.test/","https://user@tvroom42.org/","https://tvroom42.org:443/"))assertFalse(TvRoomDomain.allowRedirect("https://tvroom42.org/",s));
    }
    @Test public void savedPriorityAndPersistenceFailure(){
        TvRoomDomain d=new TvRoomDomain();Fake h=new Fake();h.saved="https://tvroom47.org";
        assertEquals(h.saved,d.current(h));assertEquals(h.saved,d.remember(h,"https://tvroom42.org"));assertEquals(0,h.writes);
        h.persist=false;assertEquals(h.saved,d.remember(h,"https://tvroom48.org"));assertEquals(0,h.writes);
        h.persist=true;assertEquals("https://tvroom48.org",d.remember(h,"https://tvroom48.org"));assertEquals(1,h.writes);
    }
    @Test public void newerHintValidatedBeforeRequest() throws Throwable {
        TvRoomDomain d=new TvRoomDomain();Fake h=new Fake();h.saved="https://tvroom42.org";h.hint="https://tvroom50.org";
        h.replies.put(h.hint+"/",HTML);h.replies.put(h.hint+"/video/a","detail");
        assertEquals("detail",d.fetch(h,"https://tvroom42.org/video/a",empty()));
        assertEquals(Arrays.asList(TvRoomDomain.REGISTRY,h.hint+"/",h.hint+"/video/a"),h.urls);assertEquals(h.hint,h.saved);
    }
    @Test public void fakeHintNeverSavedAndNextFiveTried() throws Throwable {
        TvRoomDomain d=new TvRoomDomain();Fake h=new Fake();h.saved="https://tvroom42.org";h.hint="https://tvroom50.org";
        h.replies.put(h.hint+"/","<title>티비룸</title>");h.replies.put("https://tvroom42.org/video/a",new IllegalStateException("HTTP 403: url"));
        h.replies.put("https://tvroom47.org/",HTML);h.replies.put("https://tvroom47.org/video/a","recovered");
        assertEquals("recovered",d.fetch(h,"https://tvroom42.org/video/a",empty()));
        for(int i=43;i<=47;i++)assertTrue(h.urls.contains("https://tvroom"+i+".org/"));
        assertEquals("https://tvroom47.org",h.saved);assertEquals(1,h.writes);
    }
    @Test public void protectedPageAndDnsFailuresRecover() throws Throwable {
        for(Object fail:Arrays.asList("<title>Just a moment</title>challenge-platform",new UnknownHostException("DNS"),new IllegalStateException("연결 실패: ERR_NAME_NOT_RESOLVED"))){
            TvRoomDomain d=new TvRoomDomain();Fake h=new Fake();h.replies.put(TvRoomDomain.SEED+"/video/a",fail);
            h.replies.put("https://tvroom43.org/",HTML);h.replies.put("https://tvroom43.org/video/a","ok");
            assertEquals("ok",d.fetch(h,TvRoomDomain.SEED+"/video/a",empty()));assertEquals("https://tvroom43.org",h.saved);
        }
    }
    @Test public void allFailuresKeepSavedAndCooldown() throws Throwable {
        TvRoomDomain d=new TvRoomDomain();Fake h=new Fake();h.saved="https://tvroom42.org";
        try{d.fetch(h,h.saved+"/video/a",empty());fail();}catch(IOException expected){}
        assertEquals("https://tvroom42.org",h.saved);assertEquals(0,h.writes);int before=h.urls.size();
        try{d.fetch(h,h.saved+"/video/a",empty());fail();}catch(IOException expected){}
        assertEquals(before+1,h.urls.size());
    }
    @Test public void episode404NeverTriggersDiscovery() throws Throwable {
        TvRoomDomain d=new TvRoomDomain();Fake h=new Fake();h.replies.put(TvRoomDomain.SEED+"/video/a",new IllegalStateException("HTTP 404: episode"));
        try{d.fetch(h,TvRoomDomain.SEED+"/video/a",empty());fail();}catch(IllegalStateException expected){}
        assertEquals(2,h.urls.size());assertEquals(0,h.writes);
    }
    @Test public void staleRequestsDropCredentialsAndNeverRegress() throws Throwable {
        TvRoomDomain d=new TvRoomDomain();Fake h=new Fake();h.saved="https://tvroom47.org";h.hint="https://tvroom42.org";
        h.replies.put(h.saved+"/video/a","ok");Map<String,String> headers=new HashMap<>();headers.put("Cookie","private");headers.put("Authorization","private");headers.put("Origin","https://tvroom40.org");
        assertEquals("ok",d.fetch(h,"https://tvroom40.org/video/a",headers));
        assertFalse(h.headers.get(1).containsKey("Cookie"));assertFalse(h.headers.get(1).containsKey("Authorization"));assertEquals(h.saved,h.headers.get(1).get("Origin"));assertEquals(0,h.writes);
    }
    @Test public void asynchronousCompletionResumesExactlyOnce() throws Throwable {
        TvRoomDomain d=new TvRoomDomain();Fake h=new Fake();h.async=true;h.replies.put(TvRoomDomain.SEED+"/video/a",new IOException());h.replies.put("https://tvroom43.org/",HTML);h.replies.put("https://tvroom43.org/video/a","async result");
        assertSame(h.suspended,d.fetch(h,TvRoomDomain.SEED+"/video/a",empty()));assertEquals(0,h.completions);h.drain();assertEquals(1,h.completions);assertEquals("async result",h.result);assertNull(h.failure);
    }
    @Test public void cancellationStopsProbesAndWrites() throws Throwable {
        TvRoomDomain d=new TvRoomDomain();Fake h=new Fake();h.async=true;
        assertSame(h.suspended,d.fetch(h,TvRoomDomain.SEED+"/video/a",empty()));h.active=false;h.drain();assertEquals(1,h.urls.size());assertEquals(0,h.writes);assertTrue(h.failure instanceof CancellationException);
    }
    @Test public void retryOnlyOnce() throws Throwable {
        TvRoomDomain d=new TvRoomDomain();Fake h=new Fake();h.replies.put("https://tvroom43.org/",HTML);
        try{d.fetch(h,TvRoomDomain.SEED+"/video/a",empty());fail();}catch(IOException expected){}
        assertEquals(1,h.writes);assertFalse(h.urls.contains("https://tvroom44.org/"));
    }
    @Test public void startsAtTheLastWorkingAddress() {
        Fake h=new Fake();assertEquals("https://tvroom42.org",new TvRoomDomain().current(h));
        h.saved="https://tvroom40.org";assertEquals("https://tvroom42.org",new TvRoomDomain().current(h));
    }
}
