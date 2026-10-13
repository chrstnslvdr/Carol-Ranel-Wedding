// DEMO GUEST LIST — used only while config.js has no scriptUrl.
// The real guest list lives in the Google Sheet (see SETUP.md).
// One entry per person; people on the same invitation share the same `invitation`.
window.GUESTS = [
  { id: "d01", invitation: "Cristina, RB & Winnie", name: "Cristina Ramos" },
  { id: "d02", invitation: "Cristina, RB & Winnie", name: "RB Ramos" },
  { id: "d03", invitation: "Cristina, RB & Winnie", name: "Winnie Tuano" },

  { id: "d04", invitation: "The Aquino Family", name: "Cecile Aquino", status: "Attending", answeredBy: "Cecile Aquino", table: "3" },
  { id: "d05", invitation: "The Aquino Family", name: "Eric Aquino", status: "Attending", answeredBy: "Cecile Aquino", table: "3" },
  { id: "d06", invitation: "The Aquino Family", name: "Joyce Aquino", status: "Attending", answeredBy: "Cecile Aquino", table: "3" },
  { id: "d07", invitation: "The Aquino Family", name: "Reynald Aquino", status: "Not attending", answeredBy: "Cecile Aquino" },
  { id: "d08", invitation: "The Aquino Family", name: "Raymundo Aquino" },
  { id: "d09", invitation: "The Aquino Family", name: "Mila Aquino" },

  { id: "d10", invitation: "Juan & Maria Dela Cruz", name: "Juan Dela Cruz" },
  { id: "d11", invitation: "Juan & Maria Dela Cruz", name: "María Dela Cruz" },

  { id: "d12", invitation: "Ana Santos", name: "Ana Santos" },

  { id: "d13", invitation: "Jose & Lorna Garcia", name: "Jose Garcia", status: "Attending", answeredBy: "Lorna Garcia", table: "5" },
  { id: "d14", invitation: "Jose & Lorna Garcia", name: "Lorna Garcia", status: "Attending", answeredBy: "Lorna Garcia", table: "5" }
];
