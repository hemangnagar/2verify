import { describe, expect, it } from "vitest";
import { jaroWinkler, leieRowToRecord, matchRoster, normalizeName, parseCsv } from "./matching";

const okafor = { id: "p1", firstName: "Robert", lastName: "Okafor", dob: new Date("1972-05-05T00:00:00Z"), npi: "1234567893" };
const rahman = { id: "p2", firstName: "Aisha", lastName: "Rahman", dob: new Date("1997-11-03T00:00:00Z"), npi: null };

describe("normalizeName / jaroWinkler", () => {
  it("normalizes accents, case and punctuation", () => {
    expect(normalizeName("  O'Brien-Núñez ")).toBe("OBRIENNUNEZ");
  });
  it("scores identical strings 1 and unrelated strings low", () => {
    expect(jaroWinkler("OKAFOR, ROBERT", "OKAFOR, ROBERT")).toBe(1);
    expect(jaroWinkler("OKAFOR, ROBERT", "ZELLER, DOROTHY")).toBeLessThan(0.6);
  });
});

describe("matchRoster", () => {
  it("matches on exact NPI with score 1", () => {
    const m = matchRoster([okafor], [{ lastName: "SOMEONE", firstName: "ELSE", npi: "1234567893" }]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ matchedOn: "npi", score: 1 });
  });
  it("matches on exact name + DOB", () => {
    const m = matchRoster([okafor], [{ lastName: "Okafor", firstName: "ROBERT", dob: "19720505" }]);
    expect(m[0]).toMatchObject({ matchedOn: "name_dob", score: 1 });
  });
  it("rules out a same-name record whose DOB differs", () => {
    expect(matchRoster([okafor], [{ lastName: "Okafor", firstName: "Robert", dob: "1960-01-01" }])).toHaveLength(0);
  });
  it("flags a same-name record with no DOB as a capped fuzzy match for review", () => {
    const m = matchRoster([okafor], [{ lastName: "OKAFOR", firstName: "ROBERT", middleName: "A", state: "OH" }]);
    expect(m[0]).toMatchObject({ matchedOn: "fuzzy_name" });
    expect(m[0].score).toBeCloseTo(0.9, 5);
  });
  it("does not flag unrelated people", () => {
    expect(matchRoster([rahman], [{ lastName: "RADCLIFFE", firstName: "ASHLEY" }, { lastName: "RAHMAN", firstName: "AISHAH", dob: "19800101" }])).toHaveLength(0);
  });
  it("keeps only the best candidate per person", () => {
    const m = matchRoster([okafor], [
      { lastName: "OKAFOR", firstName: "ROBERT" },
      { lastName: "OKAFOR", firstName: "ROBERT", npi: "1234567893" },
    ]);
    expect(m).toHaveLength(1);
    expect(m[0].matchedOn).toBe("npi");
  });
});

describe("parseCsv / leieRowToRecord", () => {
  it("parses quoted LEIE rows", () => {
    const rows = parseCsv('"LASTNAME","FIRSTNAME","MIDNAME","NPI","DOB","STATE"\n"DOE","JANE, JR","","0000000000","19700101","TX"\n');
    expect(rows).toHaveLength(1);
    const rec = leieRowToRecord(rows[0]);
    expect(rec).toMatchObject({ lastName: "DOE", firstName: "JANE, JR", npi: null, dob: "19700101", state: "TX" });
  });
});
