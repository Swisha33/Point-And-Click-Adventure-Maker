function love.conf(t)
  t.identity = "SirLicksALot"      -- save folder name
  t.version = "11.4"
  t.window.title = "Sir Licks-a-Lot"
  t.window.width = 960
  t.window.height = 540
  t.window.resizable = true
  t.window.minwidth = 480
  t.window.minheight = 270
  t.modules.joystick = true
  t.modules.physics = false
  t.externalstorage = false
end
