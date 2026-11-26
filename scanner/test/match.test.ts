import { describe, expect, it } from "vitest";
import { classify, requiredYears, titleYears } from "../src/match/classify.js";
import { classifyLocation } from "../src/match/location.js";
import { skillHits, topKeywords } from "../src/match/keywords.js";
import { extractPay, visaOrRelocation, workAuthBlock } from "../src/match/extras.js";
import { DEFAULT_PROFILE } from "../src/config/profile.js";

const c = (title: string, description?: string, levelOverrides?: Record<string, "entry" | "ok">) =>
  classify({ title, description, company: { levelOverrides }, profile: DEFAULT_PROFILE, maxYears: 2 });

describe("classify: role exclusions", () => {
  it.each([
    ["QA Engineer", "QA / test role"],
    ["SDET II", "QA / test role"],
    ["Software Engineer in Test", "QA / test role"],
    ["Software Development Engineer in Test, Retail", "QA / test role"],
    ["Software Engineer Apprenticeship", "internship"],
    ["Customer Experience Engineer II", "customer-facing role"],
    ["Business Intelligence Engineer II", "non-engineering role"],
    ["Fraud Analytics Engineer", "non-engineering role"],
    ["Language Engineer (Indian English)", "non-engineering role"],
    ["Software Engineer, PhD, Early Career, 2026", "PhD-only role"],
    ["iOS Engineer", "mobile role"],
    ["Data Scientist", "research / data science role"],
    ["Applied Scientist II", "research / data science role"],
    ["Solutions Engineer", "customer-facing role"],
    ["Technical Support Engineer", "customer-facing role"],
    ["ASIC Design Engineer", "hardware / non-software engineering"],
    ["Software Engineering Intern", "internship"],
    ["Frontend Engineer", "front-end only role"],
    ["Senior Software Engineer", "senior / lead level"],
    ["Sr. Backend Engineer", "senior / lead level"],
    ["Staff Engineer", "senior / lead level"],
    ["Engineering Manager", "senior / lead level"],
    ["Software Development Engineer III", "level III is above target"],
    ["Product Manager", "non-engineering role"],
    ["Business Expert", "not a software development title"],
  ])("%s -> rejected (%s)", (title, why) => {
    const r = c(title);
    expect(r.tier).toBeNull();
    expect(r.reasons[0]).toBe(why);
  });

  it("keeps full-stack titles that mention front end", () => {
    expect(c("Full Stack Engineer (Frontend + Backend)").tier).not.toBeNull();
  });

  it("does not reject backend titles that contain 'customer'", () => {
    expect(c("Backend Engineer, Customer Platform").tier).not.toBeNull();
  });
});

describe("classify: tiers", () => {
  it("entry-level backend title is Tier A", () => {
    expect(c("Software Engineer I, Backend").tier).toBe("A");
    expect(c("SDE-1").tier).not.toBeNull();
  });

  it("new grad generic SWE with matching skills is Tier A", () => {
    const r = c("Software Engineer - New Grad", "Experience with Java, Python, SQL and REST APIs.");
    expect(r.tier).toBe("A");
    expect(r.reasons).toContain("entry level");
  });

  it("years requirement above 2 rejects; 2 or fewer is kept", () => {
    expect(c("Software Engineer", "Minimum qualifications: 3+ years of software development experience.").tier).toBeNull();
    expect(c("Backend Engineer", "Minimum: 2 years of professional experience with Node.js.").tier).toBe("A");
    expect(c("Software Engineer", "1+ years of experience in Java").reasons).toContain("entry level");
  });

  it("plain title with no level info and no skills is Maybe", () => {
    expect(c("Software Engineer").tier).toBe("Maybe");
  });

  it("level II is kept as B by default, Google III allowed via override", () => {
    expect(c("Software Engineer II").tier).toBe("B");
    expect(c("Software Engineer III, Google Cloud").tier).toBeNull();
    expect(c("Software Engineer III, Google Cloud", undefined, { II: "entry", III: "ok" }).tier).not.toBeNull();
  });
});

describe("titleYears", () => {
  it("reads experience ranges stated in the title", () => {
    expect(titleYears("Software Engineer (3-5)")).toBe(3);
    expect(titleYears("Site Reliability Engineer - On-Prem (4 to 8 Years)")).toBe(4);
    expect(titleYears("Software Engineer (Data Platform, 5-7 years)")).toBe(5);
    expect(titleYears("Backend Engineer, 5+ yrs")).toBe(5);
    expect(titleYears("Software Engineer 2 - Payments")).toBeUndefined();
    expect(titleYears("Platform Engineer 1")).toBeUndefined();
  });

  it("rejects titles above the limit and keeps those within it", () => {
    expect(classify({ title: "Software Engineer (Data Platform, 5-7 years)", company: {}, profile: DEFAULT_PROFILE, maxYears: 2 })).toMatchObject({ tier: null, minYears: 5 });
    expect(classify({ title: "Backend Engineer (1 to 4 Years)", description: "8 years of experience preferred", company: {}, profile: DEFAULT_PROFILE, maxYears: 2 }).tier).not.toBeNull();
  });
});

describe("requiredYears", () => {
  it("takes the first experience mention (minimum qualifications)", () => {
    expect(requiredYears("Minimum: 1 year of experience with Java. Preferred: 5 years of experience in distributed systems.")).toBe(1);
    expect(requiredYears("- 4+ years of non-internship professional software development experience")).toBe(4);
    expect(requiredYears("0-2 years of experience")).toBe(0);
  });
  it("ignores year mentions unrelated to experience", () => {
    expect(requiredYears("Founded 25 years ago, we serve customers.")).toBeUndefined();
  });
});

describe("classifyLocation", () => {
  const L = (locations: string[], remoteHint = false) => classifyLocation({ locations, remoteHint, companyHqTimeZone: "America/Los_Angeles" });

  it.each([
    ["Bengaluru, Karnataka, India", "Bengaluru"],
    ["Bangalore", "Bengaluru"],
    ["IN, TS, Hyderabad", "Hyderabad"],
    ["Gurgaon, Haryana", "Gurugram"],
    ["Noida, Uttar Pradesh, India", "Noida"],
    ["New Delhi", "Delhi"],
    ["Pune, Maharashtra", "Pune"],
  ])("%s -> %s (IST)", (loc, display) => {
    const r = L([loc]);
    expect(r.accepted).toBe(true);
    expect(r.display).toBe(display);
    expect(r.recruiterTimeZone).toBe("Asia/Kolkata");
  });

  it("rejects other cities", () => {
    expect(L(["Chennai, India"]).accepted).toBe(false);
    expect(L(["San Francisco, CA"]).accepted).toBe(false);
  });

  it("accepts global remote with the company HQ time zone", () => {
    for (const s of ["Remote", "Remote - Remote", "Remote (Worldwide)", "Anywhere"]) {
      const r = L([s]);
      expect(r.accepted, s).toBe(true);
      expect(r.remote).toBe(true);
      expect(r.recruiterTimeZone).toBe("America/Los_Angeles");
    }
  });

  it("rejects remote restricted to another country", () => {
    for (const s of ["Remote - US", "US-Remote", "Remote, Canada", "Remote in the US", "United States (Remote)", "Remote - EMEA"]) {
      expect(L([s]).accepted, s).toBe(false);
    }
  });

  it("accepts remote India and APAC", () => {
    expect(L(["Remote - India"]).display).toBe("Remote (India)");
    expect(L(["Remote, APAC"]).accepted).toBe(true);
  });

  it("prefers a target city when several locations are listed", () => {
    const r = L(["San Francisco, CA", "Bengaluru, India", "Remote"]);
    expect(r.display).toBe("Bengaluru / Remote");
    expect(r.recruiterTimeZone).toBe("Asia/Kolkata");
  });

  it("flags Workday placeholders as unknown", () => {
    expect(L(["2 Locations"]).unknown).toBe(true);
  });

  it("country-only India is accepted, and dropped when a real city is listed", () => {
    expect(L(["India"]).accepted).toBe(true);
    expect(L(["Bengaluru, India", "India"]).display).toBe("Bengaluru");
  });
});

describe("keywords", () => {
  const jd = "We use Java and Kafka. Java services on AWS. Kafka streams, Java, Docker, and Kubernetes. REST APIs.";
  it("ranks by frequency and marks resume skills", () => {
    const k = topKeywords(jd, DEFAULT_PROFILE.skills);
    expect(k[0]).toEqual({ term: "java", onResume: true });
    expect(k[1]).toEqual({ term: "kafka", onResume: false });
    expect(k).toHaveLength(5);
  });
  it("does not confuse javascript with java", () => {
    expect(skillHits("Strong JavaScript skills", ["java"])).toEqual([]);
    expect(skillHits("Strong JavaScript skills", ["javascript"])).toEqual(["javascript"]);
  });
  it("matches node.js aliases", () => {
    expect(skillHits("Experience with NodeJS", ["node.js"])).toEqual(["node.js"]);
  });
});

describe("extras", () => {
  it("detects work-authorization restrictions", () => {
    expect(workAuthBlock("You must be authorized to work in the United States.")).toBeTruthy();
    expect(workAuthBlock("Candidates must be located in the US or Canada.")).toBeTruthy();
    expect(workAuthBlock("Work from anywhere. We hire globally.")).toBeUndefined();
  });
  it("extracts stated pay", () => {
    expect(extractPay("CTC: ₹25,00,000 - ₹35,00,000 per year")).toMatch(/25,00,000/);
    expect(extractPay("Compensation 18-24 LPA")).toBe("18-24 LPA");
    expect(extractPay("The base salary range is $120,000 - $150,000 USD")).toMatch(/\$120,000/);
    expect(extractPay("Competitive salary")).toBeUndefined();
  });
  it("visa / relocation with negation handling", () => {
    expect(visaOrRelocation("Relocation assistance available.")).toBe(true);
    expect(visaOrRelocation("We are unable to sponsor visas or relocation.")).toBe(false);
  });
});
