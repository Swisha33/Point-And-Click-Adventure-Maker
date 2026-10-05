// Default project config. The editor can overwrite this file via "DOWNLOAD PROJECT".
// Same structure is exported as game/config.lua for the Lua engine.
export const defaultGameConfig = {
  "version": 2,
  "startScene": "village",
  "sceneOrder": ["village", "bridge", "tower"],
  "spawns": {
    "village": { "x": 750, "y": 440 },
    "bridge": { "x": 780, "y": 470 },
    "tower": { "x": 470, "y": 505 }
  },
  "images": {
    "village": { "bg": "assets/village.png", "path": "assets/path/village_path.png", "fg": "assets/village_fg.png" },
    "bridge": { "bg": "assets/bridge.png", "path": "assets/path/bridge_path.png" },
    "tower": { "bg": "assets/tower.png", "path": "assets/path/tower_path.png" }
  },
  "backgrounds": {
    "village": { "x": 0, "y": 0, "scale": 1, "fit": "stretch" },
    "bridge": { "x": 0, "y": 0, "scale": 1, "fit": "stretch" },
    "tower": { "x": 0, "y": 0, "scale": 1, "fit": "contain" }
  },
  // knight size by depth: scale = far + t^exp * (near - far), t = (pos - from) / (to - from)
  "perspective": {
    "village": { "axis": "y", "from": 300, "to": 540, "far": 0.5, "near": 1.1, "exp": 1 },
    "bridge": { "axis": "x", "from": 0, "to": 960, "far": 0.2, "near": 1.1, "exp": 0.7 },
    "tower": { "axis": "y", "from": 250, "to": 540, "far": 0.3, "near": 1.0, "exp": 1 }
  },
  "exits": {
    "village": [{ "target": "bridge", "text": "To Bridge" }],
    "bridge": [{ "target": "village", "text": "To Village" }],
    "tower": [{ "target": "bridge", "text": "To Bridge" }]
  },
  "audio": {
    "music": "assets/music.mp3",
    "click": "assets/click.mp3"
  },
  "volumes": { "music": 0.5, "amb": 0.5, "sfx": 0.5 },
  "hotspots": {
    "village": [
      {
        "id": "mailbox",
        "name": "Mailbox",
        "x": 130,
        "y": 250,
        "r": 45,
        "w": 90,
        "h": 90,
        "tx": 130,
        "ty": 150,
        "anchor": "object",
        "sound": null,
        "reactions": [
          {
            "verb": "look",
            "lines": [
              {
                "speaker": "knight",
                "text": "An old red mailbox. Something rattles inside."
              }
            ]
          },
          {
            "verb": "use",
            "once": true,
            "lines": [
              {
                "speaker": "knight",
                "text": "A letter... and an empty jar!"
              }
            ],
            "actions": [
              {
                "type": "give",
                "key": "letter"
              },
              {
                "type": "give",
                "key": "jar"
              }
            ]
          },
          {
            "verb": "use",
            "lines": [
              {
                "speaker": "knight",
                "text": "It's empty now."
              }
            ]
          }
        ]
      },
      {
        "id": "frog",
        "name": "Frog",
        "x": 405,
        "y": 370,
        "r": 50,
        "w": 100,
        "h": 100,
        "tx": 420,
        "ty": 250,
        "anchor": "object",
        "sound": null,
        "reactions": [
          {
            "verb": "look",
            "lines": [
              {
                "speaker": "knight",
                "text": "A frog wearing sunglasses. Very cool."
              }
            ]
          },
          {
            "verb": "talk",
            "if": [
              {
                "type": "flag",
                "key": "frog_fed"
              }
            ],
            "lines": [
              {
                "speaker": "object",
                "text": "Burp. Good luck at the tower, knight."
              }
            ]
          },
          {
            "verb": "talk",
            "lines": [
              {
                "speaker": "object",
                "text": "What do you want, tin can?"
              }
            ],
            "choices": [
              {
                "text": "Who are you?",
                "lines": [
                  {
                    "speaker": "object",
                    "text": "I guard the tower key. Obviously."
                  }
                ]
              },
              {
                "text": "Can I lick you?",
                "once": true,
                "lines": [
                  {
                    "speaker": "object",
                    "text": "READ. THE. SIGN!",
                    "effect": "angry"
                  }
                ],
                "actions": [
                  {
                    "type": "dignity",
                    "value": -1
                  }
                ]
              },
              {
                "text": "Can I have the key?",
                "lines": [
                  {
                    "speaker": "object",
                    "text": "Bring me a snack. Something that buzzes."
                  }
                ]
              },
              {
                "text": "I have a letter for you.",
                "if": [
                  {
                    "type": "item",
                    "key": "letter"
                  }
                ],
                "lines": [
                  {
                    "speaker": "object",
                    "text": "Bills. Always bills. Keep it."
                  }
                ]
              }
            ]
          },
          {
            "verb": "item",
            "item": "fly_jar",
            "lines": [
              {
                "speaker": "object",
                "text": "Crunchy! Here, take the tower key."
              }
            ],
            "actions": [
              {
                "type": "take",
                "key": "fly_jar"
              },
              {
                "type": "give",
                "key": "key"
              },
              {
                "type": "set",
                "key": "frog_fed"
              }
            ]
          },
          {
            "verb": "item",
            "item": "fly",
            "lines": [
              {
                "speaker": "knight",
                "text": "It would fly away. I need to put it in something."
              }
            ]
          }
        ]
      },
      {
        "id": "duck",
        "name": "Duck",
        "x": 190,
        "y": 385,
        "r": 45,
        "w": 90,
        "h": 90,
        "tx": 190,
        "ty": 270,
        "anchor": "object",
        "sound": null,
        "reactions": [
          {
            "verb": "look",
            "lines": [
              {
                "speaker": "knight",
                "text": "A duck. A fly is buzzing around it."
              }
            ]
          },
          {
            "verb": "use",
            "if": [
              {
                "type": "noflag",
                "key": "got_fly"
              }
            ],
            "lines": [
              {
                "speaker": "knight",
                "text": "Got it! The fly is buzzing in my hand."
              }
            ],
            "actions": [
              {
                "type": "give",
                "key": "fly"
              },
              {
                "type": "set",
                "key": "got_fly"
              }
            ]
          },
          {
            "verb": "talk",
            "lines": [
              {
                "speaker": "object",
                "text": "Quack."
              }
            ]
          }
        ]
      }
    ],
    "bridge": [
      {
        "id": "troll",
        "name": "Troll",
        "x": 600,
        "y": 250,
        "r": 90,
        "w": 180,
        "h": 180,
        "tx": 600,
        "ty": 110,
        "anchor": "object",
        "sound": null,
        "reactions": [
          {
            "verb": "look",
            "lines": [
              {
                "speaker": "knight",
                "text": "A troll reading '101 Ways to Annoy Knights'."
              }
            ]
          },
          {
            "verb": "talk",
            "if": [
              {
                "type": "flag",
                "key": "troll_ok"
              }
            ],
            "lines": [
              {
                "speaker": "object",
                "text": "Go on. Shoo."
              }
            ]
          },
          {
            "verb": "talk",
            "lines": [
              {
                "speaker": "object",
                "text": "Hmpf. What?"
              }
            ],
            "choices": [
              {
                "text": "Let me pass to the tower!",
                "lines": [
                  {
                    "speaker": "object",
                    "text": "Only with the tower key."
                  }
                ]
              },
              {
                "text": "Nice book.",
                "once": true,
                "lines": [
                  {
                    "speaker": "object",
                    "text": "Chapter 7 is about you."
                  }
                ]
              }
            ]
          },
          {
            "verb": "item",
            "item": "key",
            "lines": [
              {
                "speaker": "object",
                "text": "The tower key... fine. Go."
              }
            ],
            "actions": [
              {
                "type": "set",
                "key": "troll_ok"
              },
              {
                "type": "exit",
                "key": "tower",
                "value": "To Tower"
              }
            ]
          }
        ]
      }
    ],
    "tower": []
  },
  "lickConfig": {
    "text": "Lick Scene",
    "response": "Sir Licks-a-Lot: 'Adventure!'",
    "dignityChange": -1
  },
  "levelLicks": {},
  "levelFollowerAccess": {},
  "player": null,
  "knight": { "image": "assets/knight.png", "frames": 5, "animSpeed": 6, "offY": 35, "baseScale": 0.55, "speed": 6 },
  "ui": { "orb": "assets/hotspot.png", "bubble": "assets/character_talk.png", "panelBox": "assets/uitext.png", "font": "assets/font.ttf" },
  "items": {
    "letter": {
      "name": "Letter",
      "icon": "assets/items/letter.png",
      "desc": "A letter for the frog. It smells like bills."
    },
    "jar": {
      "name": "Empty Jar",
      "icon": "assets/items/jar.png",
      "desc": "An empty glass jar."
    },
    "fly": {
      "name": "Fly",
      "icon": "assets/items/fly.png",
      "desc": "Bzzzzz."
    },
    "fly_jar": {
      "name": "Fly in a Jar",
      "icon": "assets/items/fly_jar.png",
      "desc": "A snack, safely packed."
    },
    "key": {
      "name": "Tower Key",
      "icon": "assets/items/key.png",
      "desc": "The key to the tower."
    }
  },
  "combos": [
    {
      "a": "jar",
      "b": "fly",
      "result": "fly_jar",
      "text": "The fly is trapped in the jar.",
      "consume": true
    }
  ],
  "interaction": { "mode": "verbs", "walkFirst": true, "defaults": {} },
  "startDignity": 3,
  "allowDebug": true,
  "titleScreen": {
    "backgroundImage": "assets/title.png",
    "titleText": "Sir Licks-a-Lot",
    "startButtonText": "Start Adventure",
    "showTitleText": true
  }
};
