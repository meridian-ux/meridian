import java.util.Arrays;
import meridian.ui.v1.Affordance;
import meridian.ui.v1.AffordanceProto;

// Compile this consumer once against the old generated classes, then run that
// unchanged bytecode against each replacement. This is not a production DTO.
public final class LegacyAffordanceConsumer {
  public static void main(String[] args) throws Exception {
    var action = Affordance.newBuilder().setLabel("Go").setUri("/next").build();
    if (!action.getLabel().equals("Go") || !action.getUri().equals("/next")) {
      throw new AssertionError("message API changed");
    }
    if (!Arrays.equals(action.toByteArray(), Affordance.parseFrom(action.toByteArray()).toByteArray())) {
      throw new AssertionError("wire round trip changed");
    }
    if (args.length > 0 && args[0].equals("--legacy-descriptor")) {
      if (!Affordance.getDescriptor().getFile().getName().equals("proto/affordance.proto")
          || AffordanceProto.getDescriptor().findMessageTypeByName("Affordance") == null) {
        throw new AssertionError("descriptor ownership changed");
      }
    }
    System.out.println("Legacy compiled message consumer passed; owner="
        + Affordance.getDescriptor().getFile().getName()
        + "; old-holder-message-count=" + AffordanceProto.getDescriptor().getMessageTypes().size());
  }
}
