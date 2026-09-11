import { describe, expect, it } from "vitest";
import { profileImageUrl } from "../auth/profile";

describe("profileImageUrl", () => {
  it("usa a foto presente nos metadados do usuÃ¡rio", () => {
    expect(profileImageUrl({ avatar_url: "https://images.example/avatar.jpg" }, [])).toBe(
      "https://images.example/avatar.jpg",
    );
  });

  it("recupera a foto da identidade quando os metadados foram editados", () => {
    expect(profileImageUrl(
      { nome_usuario: "Ana" },
      [{ identity_data: { picture: "https://images.example/google.jpg" } }],
    )).toBe("https://images.example/google.jpg");
  });

  it("mantÃ©m o fallback quando nÃ£o hÃ¡ foto HTTPS vÃ¡lida", () => {
    expect(profileImageUrl({ picture: "http://insecure.example/avatar.jpg" }, [])).toBeNull();
    expect(profileImageUrl({}, [])).toBeNull();
  });
});
