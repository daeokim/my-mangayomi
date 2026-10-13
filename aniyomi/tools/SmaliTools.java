import java.io.File;
import java.nio.file.*;
import brut.androlib.smali.SmaliBuilder;
import com.android.tools.smali.dexlib2.Opcodes;
import com.android.tools.smali.dexlib2.writer.builder.DexBuilder;
import com.android.tools.smali.dexlib2.writer.io.FileDataStore;

class SmaliTools {
  public static void main(String[] args) throws Exception {
    DexBuilder dex = new DexBuilder(new Opcodes(24));
    SmaliBuilder compiler = new SmaliBuilder(24);
    try (var files = Files.walk(Path.of(args[0]))) {
      for (Path p : files.filter(p -> p.toString().endsWith(".smali")).sorted().toList()) {
        if (!compiler.buildFile(p.toFile(),dex)) throw new IllegalStateException("Cannot assemble " + p);
      }
    }
    FileDataStore out = new FileDataStore(new File(args[1]));
    try { dex.writeTo(out); } finally { out.raf.close(); }
  }
}
