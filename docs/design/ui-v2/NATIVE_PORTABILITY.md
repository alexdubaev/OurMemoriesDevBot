# Native presentation portability

No native implementation is included. UI models and tokens are the reusable specification.
Web React components compose flex rows/stacks, images, text, scrolling and pressable actions.

| Web UI v2 | React Native | SwiftUI | Compose |
|---|---|---|---|
| Stack | View flex column | VStack | Column |
| Row | View flex row | HStack | Row |
| Screen / scroll | SafeAreaView + ScrollView | safeAreaInset + ScrollView | Scaffold + verticalScroll |
| Typography / PersonName | Text semantic style | Text + shared font style | Text + typography token |
| Pressable / onLongPress | Pressable | Button + onLongPressGesture | clickable / combinedClickable |
| Avatar / MediaSurface | Image | Image | AsyncImage / Image |
| FamilyHero | Shared View composition | Shared View | Shared composable |
| BottomTabs | View + Pressable | TabView / custom bar | NavigationBar |
| BottomSheet | Native bottom-sheet primitive | sheet | ModalBottomSheet |
| ConfirmDialog | Modal / Alert | confirmationDialog / alert | AlertDialog |
| Field | TextInput | TextField / DatePicker | TextField / DatePicker |
| Carousel | horizontal pager | TabView page style | HorizontalPager |
| Voice waveform | View bars + slider | HStack bars + Slider | Row bars + Slider |
| ReactionPicker | Pressables | Buttons | Clickable items |
| Design token | TS/JSON | Swift structs/assets | Kotlin objects/resources |
| FamilyHeroModel / MemoryCardModel | TS interface | Swift struct | Kotlin data class |
| onFeedback | Haptics adapter | UIKit feedback generator | HapticFeedback |

Browser-specific code is confined to entry/catalog URL, pointer events, semantic HTML form controls
and Modal focus trapping, inert siblings and scroll restoration. Native platforms replace these
adapters with their accessibility/gesture/navigation primitives. Model/layout/token code has no
window, endpoint, auth, cache or host SDK knowledge.

Media playback is deliberately a presentation state in Lab. Integration later supplies local/
private/MAX playback using an existing platform media engine, through callbacks. Likewise no
clipboard/share/install logic belongs in core components.

Safe areas use max(environment inset, host inset), avoiding double-counting. Android system bars
and MAX host area are explicit external inputs; iOS has the same top/bottom model.
Motion is opacity, translation and scale with short durations. No clip paths, masks, blends,
hover-only actions or measurement-based layout.
