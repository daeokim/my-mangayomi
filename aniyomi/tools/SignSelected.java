import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;
import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.security.cert.*;
import java.security.spec.*;
import java.util.*;

class SignSelected {
    public static void main(String[] args) throws Exception {
        if (args[0].equals("verify")) {
            var result = new ApkVerifier.Builder(new File(args[1])).build().verify();
            System.out.println("verified=" + result.isVerified() + " v1=" + result.isVerifiedUsingV1Scheme()
                + " v2=" + result.isVerifiedUsingV2Scheme() + " v3=" + result.isVerifiedUsingV3Scheme());
            for (var e : result.getErrors()) System.out.println("error=" + e);
            for (var e : result.getWarnings()) System.out.println("warning=" + e);
            if (!result.isVerified()) System.exit(1);
            return;
        }
        var key = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(Files.readAllBytes(Path.of(args[1]))));
        var certificate = (X509Certificate) CertificateFactory.getInstance("X.509")
            .generateCertificate(new ByteArrayInputStream(Files.readAllBytes(Path.of(args[2]))));
        var config = new ApkSigner.SignerConfig.Builder("daeokim", key, List.of(certificate)).build();
        new ApkSigner.Builder(List.of(config)).setInputApk(new File(args[3])).setOutputApk(new File(args[4]))
            .setMinSdkVersion(24).setV1SigningEnabled(true).setV2SigningEnabled(true)
            .setV3SigningEnabled(true).setV4SigningEnabled(false).build().sign();
        System.out.println("signed=" + args[4]);
    }
}
