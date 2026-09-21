# Test Plan

## Existing tests must remain green
- feed tests
- family tests
- contracts
- typecheck

## Add/update tests

### Memory actions
- delete capability true -> row visible
- delete capability false -> row absent
- details always available

### Delete spotlight
- selects correct memory ID
- source visibility hidden
- cancel restores
- confirm passes id/version
- single request under double click
- error stays open

### Theme
- switching theme changes root attribute/state
- header art URL maps to correct theme
- preference persists
- role/gender does not affect theme

### ChildHeader
- Feed has no settings
- Family has settings
- shared identity geometry component used

### BottomSheet
- Add/Settings/Actions all render shared shell
- close returns focus

## E2E
- Feed -> actions -> delete -> cancel
- Feed -> actions -> delete -> confirm
- Feed -> Family -> Feed: no header geometry jump
- Family -> Settings -> Appearance -> theme switch
- FULL vs VIEWER
