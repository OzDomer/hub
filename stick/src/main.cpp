#include <M5Unified.h>

void setup()
{
  auto cfg = M5.config();
  M5.begin(cfg);
  Serial.begin(115200);
  delay(1000); // give the monitor time to reattach after reset

  Serial.println("booted");
  Serial.printf("PSRAM: %u\n", ESP.getPsramSize());

  M5.Display.setRotation(1);
  M5.Display.setTextSize(2);
  M5.Display.println("hi Oz");
}

void loop()
{
  M5.update();
  if (M5.BtnA.wasPressed())
  {
    M5.Display.fillScreen(random(0xFFFF));
    Serial.printf("poke | PSRAM: %u\n", ESP.getPsramSize());
  }
  delay(10);
}