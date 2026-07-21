import {
  buildPreviewRows,
  detectImportTable,
  discardedColumns,
  sanitizedRows,
  suggestedMapping
} from "./importModel";

describe("Scoutnet import", () => {
  const rawHeaders = [
    "Namn",
    "Personnummer",
    "E-post",
    "Generellt - Avdelning",
    "Generellt - Patrull",
    "Anmäld",
    "Generellt - Dagar",
    "Specialkost - Har du behov av specialkost?",
    "Specialkost - Typ av specialkost",
    "Hälsodeklaration - Sjukdomar"
  ];

  it("väljer Scoutnet-importbladet och föreslår kända rubriker utan känsliga fält", () => {
    const table = detectImportTable("scoutnet.xlsx", [
      { name: "Deltagare", rows: [["Namn", "Mat Faktor", "Dagar"], ["Fel blad", "1", "2026-08-02"]] },
      { name: "A. IMPORT_HERE", rows: [rawHeaders, ["Ada Scout", "20100101-0000", "ada@example.test", "Upptäckarna", "Örnen", "Ja", "2026-08-02, 2026-08-03", "Ja", "Gluten", "Astma"]] }
    ]);
    const mapping = suggestedMapping(table);

    expect(table.sheetName).toBe("A. IMPORT_HERE");
    expect(mapping.find((column) => column.source === "Namn")?.target).toBe("display_name");
    expect(mapping.find((column) => column.source === "Generellt - Dagar")?.target).toBe("attendance_days");
    expect(mapping.find((column) => column.source === "Personnummer")?.target).toBe("ignore");
    expect(mapping.find((column) => column.source === "Hälsodeklaration - Sjukdomar")?.target).toBe("ignore");
    expect(discardedColumns(mapping)).toContain("E-post");
  });

  it("förhandsgranskar, väljer bort oanmälda och sanerar innan persistens", () => {
    const table = detectImportTable("scoutnet.csv", [{
      name: "Sheet1",
      rows: [
        rawHeaders,
        ["Ada Scout", "20100101-0000", "ada@example.test", "Upptäckarna", "Örnen", "Ja", "2026-08-02, 2026-08-03", "Ja", "Gluten", "Astma"],
        ["Bertil Scout", "20110101-0000", "bertil@example.test", "Spårarna", "Räven", "Nej", "2026-08-02", "Nej", "", "Diabetes"]
      ]
    }]);
    const preview = buildPreviewRows(table, suggestedMapping(table), { startsOn: "2026-08-02", endsOn: "2026-08-11" });
    const rows = sanitizedRows(preview);

    expect(preview[0]).toMatchObject({ included: true, displayName: "Ada Scout", dietaryNote: "Gluten" });
    expect(preview[1]?.included).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      display_name: "Ada Scout",
      division: "Upptäckarna",
      patrol: "Örnen",
      dietary_note: "Gluten"
    }));
    expect(JSON.stringify(rows)).not.toMatch(/personnummer|example\.test|Astma|Diabetes/);
  });
});
