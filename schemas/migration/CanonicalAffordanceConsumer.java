import java.io.ByteArrayOutputStream;
import java.util.List;
import com.google.protobuf.CodedOutputStream;
import com.google.protobuf.Descriptors.Descriptor;
import meridian.ui.v1.*;

// Actual removal bindings, not replacement DTOs or a baseline activation.
public final class CanonicalAffordanceConsumer {
  private static void retired(Descriptor descriptor, String name, int tag) {
    if (descriptor.findFieldByName(name) != null || descriptor.findFieldByNumber(tag) != null
        || !descriptor.toProto().getReservedNameList().contains(name)
        || descriptor.toProto().getReservedRangeList().stream()
            .noneMatch(range -> range.getStart() == tag && range.getEnd() == tag + 1)) {
      throw new AssertionError("retired field is not reserved: " + descriptor.getFullName() + "." + name);
    }
  }

  public static void main(String[] args) throws Exception {
    var rpc = RpcCall.newBuilder().setService("raw.Service").setMethod("Get").build();
    var actions = List.of(
        Affordance.newBuilder().setUri("/raw").build(),
        Affordance.newBuilder().setCommand("raw\n'$value'").build(),
        Affordance.newBuilder().setRpc(rpc).build(),
        Affordance.newBuilder().setNavigate(Navigate.newBuilder().setRoute("/form")).build(),
        Affordance.newBuilder().setOpenPanel(PanelDescriptor.getDefaultInstance()).build(),
        Affordance.newBuilder().setOpenView("raw-view").build(),
        Affordance.newBuilder().setCopy("").build());
    var tags = List.of(5, 6, 10, 11, 12, 13, 14);
    for (int index = 0; index < actions.size(); index++) {
      var value = Affordance.parseFrom(actions.get(index).toByteArray());
      if (value.getInvokeCase().getNumber() != tags.get(index)) throw new AssertionError("typed intent changed");
    }
    var action = actions.get(2).toBuilder().setLabel("Canonical")
        .setToneValue(0).setEmphasisValue(0).setRefreshOnSuccess(false).build();
    if (!action.hasTone() || !action.hasEmphasis() || !action.hasRefreshOnSuccess()) {
      throw new AssertionError("explicit zero/false presence lost");
    }
    var collection = AffordanceCollection.newBuilder().addItems(action).build();
    var view = ViewDescriptor.newBuilder().setAffordances(collection)
        .addSlots(Slot.newBuilder().setAffordances(collection)).build();
    var table = TablePanel.newBuilder().setAffordances(collection).build();
    var form = FormPanel.newBuilder().setSubmitAffordance(action).build();
    var command = Command.newBuilder().setTitle("Envelope").setAffordance(action).build();
    if (!view.getAffordances().equals(view.getSlots(0).getAffordances())
        || !table.getAffordances().getItems(0).equals(form.getSubmitAffordance())
        || !command.getAffordance().equals(action)) throw new AssertionError("canonical envelope changed");
    retired(Affordance.getDescriptor(), "style", 7);
    for (var field : List.of("rpc", "open_panel", "open_view_id", "navigate")) {
      retired(Command.getDescriptor(), field, 8 + List.of("rpc", "open_panel", "open_view_id", "navigate").indexOf(field));
    }
    retired(FormPanel.getDescriptor(), "submit", 3);
    retired(TablePanel.getDescriptor(), "actions", 6);
    retired(ViewDescriptor.getDescriptor(), "actions", 8);
    retired(Slot.getDescriptor(), "actions", 7);
    for (var name : List.of("Action", "RowAction", "OpenPanel")) {
      if (InteractionProto.getDescriptor().findMessageTypeByName(name) != null) throw new AssertionError("retired type revived");
    }
    if (InteractionProto.getDescriptor().findEnumTypeByName("AffordanceStyle") != null
        || !Command.getDescriptor().getOneofs().isEmpty()) throw new AssertionError("retired enum/oneof revived");
    // A genuine old submit wire field does not acquire a canonical target.
    var bytes = new ByteArrayOutputStream();
    var wire = CodedOutputStream.newInstance(bytes);
    wire.writeMessage(3, rpc);
    wire.flush();
    if (FormPanel.parseFrom(bytes.toByteArray()).hasSubmitAffordance()) throw new AssertionError("old submit granted intent");
    System.out.println("Canonical removal consumer passed: seven intents, nine reservations, four type retirements, and old-wire denial");
  }
}
