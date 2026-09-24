# memoLy UI v2 — complete screen and state inventory

Source: `docs/memoly-final-functional-state-pack.html`, SHA-256 `180F8C9B6E60369513CFFD5EB9DBB3CB3397649407DF996DCF907AB0FA38C5B4`, checked 2026-09-24. This is a static demo inventory, not a production route list.

## Reading the table

`BASE` is the unlayered feed shell. Hash navigation shows a named `.composer-layer`; `#sheetClosed` is an intentional unmatched sentinel that hides targeted layers. “Direct/catalog” means no ordinary anchor enters the state; the URL hash or `#stateCatalog` can still show it. Actions below list outgoing hash links other than repeated bottom navigation. All rows inherit six CSS radio themes. Responsive CSS contains breakpoints at 350/355/360/390 px and height breakpoints; screenshots cover selected child/member states at 320/390/430/480 px, not every state. Role labels here describe the demo presentation; production permissions must be checked independently.

| Group | DOM id | Name / variant | Entry | Action → target | Surface | Role |
|---|---|---|---|---|---|---|
| Family / feed shell | `#BASE` | Feed shell | direct/catalog | София 2 года 4 месяца→familyChild; Добавить ребёнка→childOnboardPhoto; Добавить→childOnboardPhoto; Действия с воспоминанием→memoryActions; 5→commentsPost; Посмотреть все 5 комментариев›→commentsPost; Фото Снимокиз жизни→photoEmpty; Заметка Мыслии события→noteEmpty | base | family/demo |
| Add / composer | `#photoEmpty` | Добавить фото | BASE, photoSelected, photoSuccess | Выберите фотографии Нажмите, чтобы выбратьдо 10 фото→photoSelected | page/state | family/demo |
| Add / composer | `#photoSelected` | Добавить фото | photoEmpty, photoSelected, photoUpload, photoProgress | Назад→photoEmpty; Добавитьдо 10 фото→photoSelected; Опубликовать (4)→photoUpload | page/state | family/demo |
| Add / composer | `#photoUpload` | Добавить фото | photoSelected, photoUpload | Назад→photoSelected; Добавитьдо 10 фото→photoSelected; Опубликовать (4)→photoUpload; 25%→photoProgress; Отменить→photoSelected | page/state | family/demo |
| Add / composer | `#photoProgress` | Добавить фото | photoUpload, photoError | Назад→photoSelected; IMG_1235.jpgЗагрузка…40%×→photoError | page/state | family/demo |
| Add / composer | `#photoError` | Добавить фото | photoProgress | Назад→photoProgress; Повторить неудачные→photoSuccess | page/state | family/demo |
| Add / composer | `#photoSuccess` | Добавить фото | photoError | Назад→photoSelected; Отлично→photoPublished; Добавить ещё→photoEmpty | page/state | family/demo |
| Add / composer | `#photoPublished` | Сегодня | photoSuccess | — | page/state | family/demo |
| Add / composer | `#noteEmpty` | Добавить заметку | BASE, noteFilled, noteSuccess | Напишите, что хотите сохранить…0/500→noteFilled | page/state | family/demo |
| Add / composer | `#noteFilled` | Добавить заметку | noteEmpty, noteSaving | Назад→noteEmpty; Опубликовать→noteSaving | page/state | family/demo |
| Add / composer | `#noteSaving` | Добавить заметку | noteFilled | Назад→noteFilled; Сохраняем заметку…Это займёт всего пару секунд→noteSuccess | page/state | family/demo |
| Add / composer | `#noteSuccess` | Заметка сохранена! | noteSaving | Смотреть в ленте→notePublished; Добавить ещё→noteEmpty | page/state | family/demo |
| Add / composer | `#notePublished` | Маленькие моментыбольшое счастье ВсеФотоВидеоГол | noteSuccess, noteEdit | •••→noteEdit | page/state | family/demo |
| Add / composer | `#noteEdit` | Редактировать заметку | notePublished, noteDelete, commentsMenu | Назад→notePublished; Удалить заметку→noteDelete; Сохранить→notePublished | page/state | family/demo |
| Add / composer | `#noteDelete` | Редактировать заметку | noteEdit | Назад→noteEdit; Отменить→noteEdit | page/state | family/demo |
| Add / composer | `#mediaChoice` | Добавить голос или видео | BASE, videoSelected, videoReady, audioSelected | Выбрать видеоГотовый видеофайлс устройства→videoSelected; Выбрать аудиоГотовый аудиофайлс устройства→audioSelected | page/state | family/demo |
| Add / composer | `#videoSelected` | Добавить видео | mediaChoice, mediaUploadingVideo, mediaProgressVideo | Назад→mediaChoice; Добавьте подпись (необязательно)0/500→videoReady; Опубликовать→mediaUploadingVideo | page/state | family/demo |
| Add / composer | `#videoReady` | Добавить видео | videoSelected | Назад→mediaChoice; Опубликовать→mediaUploadingVideo | page/state | family/demo |
| Add / composer | `#audioSelected` | Добавить аудио | mediaChoice, mediaUploadingAudio, mediaProgressAudio | Назад→mediaChoice; Опубликовать→mediaUploadingAudio | page/state | family/demo |
| Add / composer | `#mediaUploadingVideo` | Добавить видео | videoSelected, videoReady | Назад→videoSelected; 68%Загружаем видео…Можно перейти к подробному прогрессу→mediaProgressVideo | page/state | family/demo |
| Add / composer | `#mediaUploadingAudio` | Добавить аудио | audioSelected | Назад→audioSelected; 68%Загружаем аудио…Можно перейти к подробному прогрессу→mediaProgressAudio | page/state | family/demo |
| Add / composer | `#mediaProgressVideo` | Загрузка | mediaUploadingVideo, mediaErrorVideo | Назад→videoSelected; Загрузка · 68%8,4 из 12,4 МБ→mediaErrorVideo; Отменить→videoSelected; Продолжить демо→mediaSuccessVideo | page/state | family/demo |
| Add / composer | `#mediaProgressAudio` | Загрузка | mediaUploadingAudio, mediaErrorAudio | Назад→audioSelected; Загрузка · 68%1,2 из 1,8 МБ→mediaErrorAudio; Отменить→audioSelected; Продолжить демо→mediaSuccessAudio | page/state | family/demo |
| Add / composer | `#mediaErrorVideo` | Не удалось загрузить | mediaProgressVideo | Назад→mediaProgressVideo; Попробовать снова→mediaProgressVideo; Отменить→mediaChoice | page/state | family/demo |
| Add / composer | `#mediaErrorAudio` | Не удалось загрузить | mediaProgressAudio | Назад→mediaProgressAudio; Попробовать снова→mediaProgressAudio; Отменить→mediaChoice | page/state | family/demo |
| Add / composer | `#mediaSuccessVideo` | Видео опубликовано! | mediaProgressVideo | Смотреть в ленте→videoPublished; Добавить ещё→mediaChoice | page/state | family/demo |
| Add / composer | `#mediaSuccessAudio` | Аудио опубликовано! | mediaProgressAudio | Смотреть в ленте→audioPublished; Добавить ещё→mediaChoice | page/state | family/demo |
| Add / composer | `#videoPublished` | Сегодня | mediaSuccessVideo | — | page/state | family/demo |
| Add / composer | `#audioPublished` | Сегодня | mediaSuccessAudio | — | page/state | family/demo |
| Family / feed shell | `#family` | Маленькие моментыбольшое счастье София 2 года 4  | BASE, videoPublished, audioPublished, family | icon→settingsMenu; София 2 года 4 месяца→familyChild; Добавить ребёнка→childOnboardPhoto; Добавить→childOnboardPhoto; МамаАлександраВладелец›→familyMember; ПапаДмитрийПолный доступ›→familyDad; БабушкаЕленаПолный доступ›→familyGrandma; ДедушкаСергейПросмотр›→familyGrandpa | page/state | family/demo |
| Family member | `#familyMember` | Профиль владельца | family | icon→memberPhotoPicker; Сохранить изменения→memberProfileSaved | page/state | owner |
| Invites | `#familyInvite` | Пригласить родственника | family, familyInviteReady, familyInviteCopied, familyInvitePhoto | icon→familyInvitePhoto; Изменить→familyInvitePhoto; Создать приглашение→familyInviteReady | page/state | owner/full or demo |
| Invites | `#familyInviteReady` | Ссылка готова | familyInvite, familyInviteCopied, familyInviteCopyFailed | icon→familyInvite; https://memoly.app/join/AB12-7K9→inviteGuestPreview; Скопировать ссылку→familyInviteCopied; Поделиться ссылкой→familyInviteCopied; ↗Telegram→familyInviteCopied; ✉Сообщения→familyInviteCopied; •••Другие приложения→familyInviteCopied | page/state | owner/full or demo |
| Invites | `#familyInviteCopied` | Ссылка скопирована | familyInviteReady | icon→familyInviteReady; Пригласить ещё→familyInvite | page/state | owner/full or demo |
| Invites | `#inviteChecking` | Проверяем приглашение… | direct/catalog | Проверяем приглашение…Это займёт всего несколько секунд→inviteGuestPreview | page/state | family/demo |
| Invites | `#inviteJoined` | Профиль сохранён | inviteGuestProfile | — | page/state | family/demo |
| Invites | `#inviteAlready` | Вы уже в семье! | direct/catalog | — | page/state | family/demo |
| Invites | `#inviteExpired` | Ссылка устарела | direct/catalog | — | page/state | family/demo |
| Family settings | `#inviteRevoked` | Приглашение отозвано | direct/catalog | — | page/state | owner/full or demo |
| Invites | `#inviteInvalid` | Приглашение недоступно | direct/catalog | — | page/state | family/demo |
| Family member | `#familyDad` | Профиль участника | family | icon→memberPhotoPicker; Сохранить изменения→memberProfileSaved; Удалить из семьи→memberRemoveConfirm | page/state | owner/member demo |
| Family member | `#familyGrandma` | Профиль участника | family, memberPhotoPicker, memberRemoveConfirm | icon→memberPhotoPicker; Сохранить изменения→memberProfileSaved; Удалить из семьи→memberRemoveConfirm | page/state | owner/member demo |
| Family member | `#familyGrandpa` | Профиль участника | family | icon→memberPhotoPicker; Сохранить изменения→memberProfileSaved; Удалить из семьи→memberRemoveConfirm | page/state | owner/member demo |
| Family / child | `#familyChild` | Профиль ребёнка | BASE, family, childEdit, childSaved | Редактировать профиль→childEdit | page/state | family/demo |
| Family / child | `#childEdit` | Редактировать профиль | familyChild, childPhoto | icon→familyChild; icon→childPhoto; Заменить фотографию→childPhoto; Сохранить профиль→childSaved | page/state | owner/edit-capable |
| Family / child | `#childPhoto` | Фотография ребёнка | childEdit | icon→childEdit; Использовать это фото→childEdit | page/state | owner/edit-capable |
| Family / child | `#childSaved` | Профиль ребёнка обновлёнИмя, дата рождения, пол  | childEdit, childOnboardPhoto | icon→familyChild; Перейти в профиль→familyChild | page/state | owner/edit-capable |
| Family / child | `#childPhotoSaved` | Фото обновлено!Новое фото профиля сохранено.Пере | direct/catalog | icon→familyChild; Перейти в профиль→familyChild | page/state | owner/edit-capable |
| Family / child | `#childOnboardPhoto` | Добавить ребёнка | BASE, family, childValidation, childEmpty | Добавить ребёнка→childSaved | page/state | owner/edit-capable |
| Family / child | `#childValidation` | Редактировать профиль | direct/catalog | icon→childOnboardPhoto | page/state | family/demo |
| Family / child | `#childEmpty` | Добавьте профиль ребёнкаРасскажите немного о ваш | direct/catalog | Добавить ребёнка→childOnboardPhoto | page/state | family/demo |
| Feed / memory | `#commentsPost` | Публикация | BASE, commentsWrite, commentsReply, commentsValidation | Меню публикации→commentsMenu; Ответить→commentsReply; Написать комментарий…→commentsWrite | page/state | family/demo |
| Feed / memory | `#commentsWrite` | Публикация | commentsPost, commentsAdded, commentsEmpty | Назад→commentsPost; Меню публикации→commentsMenu; Отправить→commentsAdded | page/state | family/demo |
| Feed / memory | `#commentsAdded` | Публикация | commentsWrite, commentsReply, commentsSuccess | Меню публикации→commentsMenu; Написать комментарий…→commentsWrite | page/state | family/demo |
| Feed / memory | `#commentsReply` | Комментарии | commentsPost | Назад→commentsPost; Отправить→commentsAdded | page/state | family/demo |
| Feed / memory | `#commentsEmpty` | Публикация | direct/catalog | Написать комментарий…→commentsWrite | page/state | family/demo |
| Feed / memory | `#commentsValidation` | Публикация | commentsValidation | Назад→commentsPost; Отправить→commentsValidation | page/state | family/demo |
| Feed / memory | `#commentsMenu` | Публикация | commentsPost, commentsWrite, commentsAdded | Назад→commentsPost; Закрыть меню→commentsPost; Подробнее→commentsPost; Редактировать→noteEdit; Удалить публикацию→commentsPost | page/state | family/demo |
| Feed / memory | `#commentsSuccess` | Публикация | direct/catalog | Назад→commentsAdded; Готово→commentsAdded | page/state | family/demo |
| Settings / help | `#helpMenu` | Помощь и приватностьОтветы, приватность и поддер | helpShare | Помощь и приватностьОтветы, приватность и поддержка→helpPrivacy; Поделиться приложениемОтправить ссылку на memoLy→helpShare; О memoLyИнформация о приложении→helpAbout | sheet | family/demo |
| Settings / help | `#helpPrivacy` | Помощь и приватность | helpMenu, helpPrivacyDetails, helpFaq, helpSupport | ПриватностьКак защищены семейные воспоминания→helpPrivacyDetails; ПомощьЧастые вопросы и инструкции→helpFaq; Связаться с поддержкойВопрос или проблема с приложением→helpSupport; О memoLyВерсия и информация о приложении→helpAbout; Показать состояние «Нет соединения»→helpOffline | page/state | family/demo |
| Settings / help | `#helpPrivacyDetails` | Приватность | helpPrivacy | Назад→helpPrivacy | page/state | family/demo |
| Settings / help | `#helpFaq` | Помощь | helpPrivacy | Назад→helpPrivacy | page/state | family/demo |
| Settings / help | `#helpSupport` | Связаться с поддержкой | helpPrivacy, helpSupportSent | Назад→helpPrivacy; Написать в поддержкуОткрыть новое обращение→helpSupportSent; Сообщить о проблемеОпишите, что произошло→helpSupportSent | page/state | family/demo |
| Settings / help | `#helpSupportSent` | Поддержка | helpSupport | Назад→helpSupport; Готово→helpPrivacy | page/state | family/demo |
| Settings / help | `#helpAbout` | О memoLy | helpMenu, helpPrivacy, settingsMenu | Назад→helpPrivacy | page/state | family/demo |
| Settings / help | `#helpOffline` | Помощь и приватность | helpPrivacy | Назад→helpPrivacy; Повторить→helpPrivacy | page/state | family/demo |
| Settings / help | `#helpShare` | Поделиться memoLy | helpMenu | Назад→helpMenu | page/state | family/demo |
| Settings / help | `#settingsMenu` | ОформлениеМята или тёплая розовая палитра Помощь | family, appearanceSettings, familyArchive, familyArchiveError | ОформлениеМята или тёплая розовая палитра→appearanceSettings; Помощь и приватностьОтветы, приватность и поддержка→helpPrivacy; Семейный архивИспользование приватного хранилища→familyArchive; Настройки семьиНазвание и часовой пояс→familySettings; О memoLyИнформация о приложении→helpAbout | sheet | family/demo |
| Settings / help | `#appearanceSettings` | Оформление | settingsMenu | icon→settingsMenu | page/state | family/demo |
| Feed / memory | `#memoryActions` | ПодробнееОткрыть публикацию целиком Редактироват | BASE, memoryDeleteConfirm, feedNewAvailable, viewerFeed | ПодробнееОткрыть публикацию целиком→memoryDetailFinal; РедактироватьИзменить подпись или дату ›→memoryEdit; Удалить воспоминаниеУдалить из семейной ленты→memoryDeleteSpotlight | sheet | family/demo |
| Feed / memory | `#memoryDeleteConfirm` | Удалить воспоминание? | direct/catalog | Отмена→memoryActions | dialog | family/demo |
| Invites | `#familyInvitePhoto` | Фото родственника | familyInvite | icon→familyInvite; Оставить как есть→familyInvite; Убрать фото→familyInvite | page/state | owner/full or demo |
| Invites | `#inviteGuestPreview` | Вас приглашают в семью | familyInviteReady, inviteChecking, inviteNetworkError | Присоединиться→inviteGuestAccepted | page/state | family/demo |
| Invites | `#inviteGuestAccepted` | Вы в семье! | inviteGuestPreview, inviteGuestProfile | Изменить имя или фото→inviteGuestProfile | page/state | family/demo |
| Invites | `#inviteGuestProfile` | Ваш профиль | inviteGuestAccepted, inviteGuestProfile | icon→inviteGuestAccepted; Изменить фото→inviteGuestProfile; Сохранить и перейти в ленту→inviteJoined | page/state | family/demo |
| Family member | `#memberPhotoPicker` | Фото участника | familyMember, familyDad, familyGrandma, familyGrandpa | Убрать фото→familyGrandma | page/state | owner/member demo |
| Family member | `#memberProfileSaved` | Профиль участника | familyMember, familyDad, familyGrandma, familyGrandpa | — | page/state | owner/member demo |
| Family member | `#memberRemoveConfirm` | Удалить участника из семьи? | familyDad, familyGrandma, familyGrandpa | Отмена→familyGrandma | dialog | owner/member demo |
| Family / child | `#childScopeSheet` | Показать воспоминания Выберите общую или персона | direct/catalog | Добавить ребёнка→childOnboardPhoto | sheet | family/demo |
| System / catalog | `#authError` | memoLy | direct/catalog | — | page/state | family/demo |
| System / catalog | `#openInTelegram` | memoLy | direct/catalog | — | page/state | family/demo |
| System / catalog | `#familyLoadError` | Семья | direct/catalog | — | page/state | family/demo |
| System / catalog | `#accessLost` | memoLy | familyLeaveConfirm | — | page/state | family/demo |
| System / catalog | `#noFamily` | Создайте семью Создайте семейную ленту, чтобы до | familyCreateError | Создать семью→childOnboardPhoto | page/state | family/demo |
| System / catalog | `#familyCreateError` | Не удалось создать семью Проверьте соединение и  | direct/catalog | Назад→noFamily; Повторить→noFamily | page/state | family/demo |
| Feed / memory | `#feedEmptyFull` | Маленькие моментыбольшое счастье София 2 года 4  | direct/catalog | София 2 года 4 месяца→familyChild; Добавить ребёнка→childOnboardPhoto; Добавить→childOnboardPhoto | page/state | family/demo |
| Feed / memory | `#feedEmptyViewer` | Маленькие моментыбольшое счастье София 2 года 4  | direct/catalog | София 2 года 4 месяца→familyChild; Добавить ребёнка→childOnboardPhoto; Добавить→childOnboardPhoto | page/state | viewer |
| Feed / memory | `#feedInitialError` | Маленькие моментыбольшое счастье София 2 года 4  | direct/catalog | София 2 года 4 месяца→familyChild; Добавить ребёнка→childOnboardPhoto; Добавить→childOnboardPhoto | page/state | family/demo |
| Feed / memory | `#feedNextPageError` | Маленькие моментыбольшое счастье София 2 года 4  | direct/catalog | София 2 года 4 месяца→familyChild; Добавить ребёнка→childOnboardPhoto; Добавить→childOnboardPhoto | page/state | family/demo |
| Feed / memory | `#feedNewAvailable` | Маленькие моментыбольшое счастье София 2 года 4  | direct/catalog | София 2 года 4 месяца→familyChild; Добавить ребёнка→childOnboardPhoto; Добавить→childOnboardPhoto; Действия с воспоминанием→memoryActions; 5→commentsPost; Посмотреть все 5 комментариев›→commentsPost | page/state | family/demo |
| Feed / memory | `#viewerFeed` | Маленькие моментыбольшое счастье София 2 года 4  | direct/catalog | София 2 года 4 месяца→familyChild; Добавить ребёнка→childOnboardPhoto; Добавить→childOnboardPhoto; Действия с воспоминанием→memoryActions; 5→commentsPost; Посмотреть все 5 комментариев›→commentsPost | page/state | viewer |
| Feed / memory | `#memoryDetailFinal` | Публикация | memoryActions, memoryEdit, memoryEditConflict | •••→memoryActions | page/state | family/demo |
| Feed / memory | `#memoryEdit` | Редактировать воспоминание | memoryActions, memoryEditSaving, memoryEditError, memoryEditConflict | Назад→memoryDetailFinal; Сохранить изменения→memoryEditSaving | page/state | family/demo |
| Feed / memory | `#memoryEditSaving` | Редактировать воспоминание | memoryEdit, memoryEditSaving, memoryEditError | Назад→memoryEdit; Сохраняем…→memoryEditSaving | page/state | family/demo |
| Feed / memory | `#memoryEditError` | Редактировать воспоминание | direct/catalog | Назад→memoryEdit; Сохранить изменения→memoryEditSaving | page/state | family/demo |
| Feed / memory | `#memoryEditConflict` | Конфликт изменений | direct/catalog | Назад→memoryEdit; Загрузить свежую версию→memoryEdit; Вернуться без сохранения→memoryDetailFinal | page/state | family/demo |
| Feed / memory | `#memoryDeleteSpotlight` | МамаСегодня, 10:24 245София Моё солнышко утром ☀ | memoryActions | Назад→memoryActions; Отмена→memoryActions; 5→commentsPost; Посмотреть все 5 комментариев›→commentsPost | page/state | family/demo |
| Family settings | `#familyInvites` | Активные приглашения | family, inviteRevokeConfirm, inviteRevokeError | Отозвать→inviteRevokeConfirm | page/state | owner/full or demo |
| Family settings | `#familyInvitesEmpty` | Активные приглашения | direct/catalog | Пригласить родственника→familyInvite | page/state | owner/full or demo |
| Family settings | `#inviteRevokeConfirm` | Приглашение | familyInvites, inviteRevokeError | Назад→familyInvites; Отозвать→familyInvites; Отмена→familyInvites | page/state | owner/full or demo |
| Family settings | `#inviteRevokeError` | Приглашение | direct/catalog | Назад→familyInvites; Повторить→inviteRevokeConfirm | page/state | owner/full or demo |
| Family settings | `#familyLeaveConfirm` | Семья | familyLeaveError | Выйти из семьи→accessLost | page/state | family/demo |
| Family settings | `#familyLeaveError` | Семья | direct/catalog | Повторить→familyLeaveConfirm | page/state | family/demo |
| Family settings | `#familyArchive` | Семейный архив | settingsMenu, familyArchiveError | Назад→settingsMenu | page/state | owner/full or demo |
| Family settings | `#familyArchiveError` | Семейный архив | direct/catalog | Назад→settingsMenu; Повторить загрузку→familyArchive | page/state | owner/full or demo |
| Family settings | `#familySettings` | Настройки семьи | settingsMenu, familySettingsSaving, familySettingsConflict | Назад→settingsMenu; Сохранить→familySettingsSaving | page/state | owner/full or demo |
| Family settings | `#familySettingsSaving` | Настройки семьи | familySettings, familySettingsSaving | Назад→familySettings; Сохраняем…→familySettingsSaving | page/state | owner/full or demo |
| Family settings | `#familySettingsConflict` | Настройки семьи | direct/catalog | Назад→familySettings; Обновить данные→familySettings | page/state | owner/full or demo |
| Invites | `#inviteOtherFamily` | Приглашение | direct/catalog | — | page/state | family/demo |
| Invites | `#inviteNetworkError` | Приглашение | direct/catalog | Повторить→inviteGuestPreview | page/state | family/demo |
| Invites | `#familyInviteCopyFailed` | Ссылка приглашения | direct/catalog | Назад→familyInviteReady; Назад к приглашению→familyInviteReady | page/state | owner/full or demo |
| Feed / memory | `#maxVideoLoading` | Видео | direct/catalog | — | page/state | family/demo |
| Feed / memory | `#maxVideoReady` | Видео | direct/catalog | — | page/state | family/demo |
| Feed / memory | `#maxVideoError` | Видео | direct/catalog | — | page/state | family/demo |
| Add / composer | `#maxVideoComposerIdle` | Загрузить видео | maxVideoComposerInvalid | Сохранить→maxVideoComposerUploading | page/state | family/demo |
| Add / composer | `#maxVideoComposerInvalid` | Загрузить видео | direct/catalog | Назад→maxVideoComposerIdle; Выбрать другое видео→maxVideoComposerIdle | page/state | family/demo |
| Add / composer | `#maxVideoComposerUploading` | Загрузить видео | maxVideoComposerIdle | — | page/state | family/demo |
| Add / composer | `#maxVideoComposerProcessing` | Загрузить видео | maxVideoComposerError | Повторить попытку→maxVideoComposerSuccess | page/state | family/demo |
| Add / composer | `#maxVideoComposerError` | Загрузить видео | direct/catalog | Повторить→maxVideoComposerProcessing | page/state | family/demo |
| Add / composer | `#maxVideoComposerSuccess` | Видео | maxVideoComposerProcessing | — | page/state | family/demo |
| System / catalog | `#stateCatalog` | Каталог состояний | direct/catalog | — | page/state | family/demo |

## Demo-only and directly addressable states

`#inviteChecking`, `#inviteAlready`, `#inviteExpired`, `#inviteRevoked`, `#inviteInvalid`, `#childPhotoSaved`, `#childValidation`, `#childEmpty`, `#commentsEmpty`, `#commentsSuccess`, `#memoryDeleteConfirm`, `#childScopeSheet`, `#authError`, `#openInTelegram`, `#familyLoadError`, `#familyCreateError`, `#feedEmptyFull`, `#feedEmptyViewer`, `#feedInitialError`, `#feedNextPageError`, `#feedNewAvailable`, `#viewerFeed`, `#memoryEditError`, `#memoryEditConflict`, `#familyInvitesEmpty`, `#inviteRevokeError`, `#familyLeaveError`, `#familyArchiveError`, `#familySettingsConflict`, `#inviteOtherFamily`, `#inviteNetworkError`, `#familyInviteCopyFailed`, `#maxVideoLoading`, `#maxVideoReady`, `#maxVideoError`, `#maxVideoComposerInvalid`, `#maxVideoComposerError`, `#stateCatalog`.

The state catalog links to many of these states, but it is itself reached only by direct hash navigation. The direct hash graph is an inventory aid; it does not prove a production flow exists.
# Тема и поведение демо

Статус темы управляется скрытым radio и CSS `html:has(#themeX:checked)`; в React уже есть собственный `ThemeProvider` и `data-memoly-theme`. Числа ниже сняты из вычисленных стилей canonical HTML. Кнопки, поля и навигация используют один набор мягких поверхностей, теней и акцентных градиентов в каждой теме; различается палитра, геометрия общая. Основной текст во всех шести темах `#16304b`, вторичный `#75818c`. Границы у полей и карточек полупрозрачные, на 390 px их вид мягче текущих production границ. Нижняя панель: фиксированная, с центральной круглой кнопкой добавления и запасом под safe area. В production палитра фона, поверхности и акцента близка, но типографика, тени, радиусы, поля, кнопки и геометрия панели ещё не совпадают.

| Тема | Переключатель | Фон | Поверхность | Акцент | Мягкий акцент | Тень |
| --- | --- | --- | --- | --- | --- | --- |
| mint | `#themeMint` | `#edf1ea` | `#f5f5ef` | `#7f9f90` | `#dce7df` | `rgba(105,124,113,.20)` |
| rose | `#themeRose` | `#f4efec` | `#f8f3ef` | `#b87580` | `#f0dcdd` | `rgba(139,105,105,.18)` |
| sky | `#themeSky` | `#eef4f7` | `#f6f8f7` | `#6f91a5` | `#dbe8ee` | `rgba(91,119,133,.18)` |
| lavender | `#themeLavender` | `#f2f0f5` | `#f8f5f3` | `#8e82a7` | `#e4deec` | `rgba(111,100,128,.16)` |
| apricot | `#themeApricot` | `#f6f0e8` | `#faf6f0` | `#c38669` | `#f1ddd0` | `rgba(133,103,81,.16)` |
| sand | `#themeSand` | `#f1efe7` | `#f8f6f0` | `#858f70` | `#e2e5d7` | `rgba(106,106,87,.16)` |

## Проверенные переходы и видимый результат

| Действие | Исходное состояние | Цель | Видимый результат / ограничение демо |
| --- | --- | --- | --- |
| Открыть профиль ребёнка | BASE / `#family` | `#familyChild` | Отдельный экран ребёнка. |
| Назад, редактировать, сохранить | `#familyChild` / `#childEdit` | `#family` / `#childEdit` / `#childSaved` | Hash переключает слой; сохранение показано без API. |
| Выбрать фото, кадрировать, увеличить, подтвердить | `#childEdit` | `#childPhoto` → `#childEdit` | Круговой ориентир кадра; ползунок zoom в проверенном DOM не менял вычисленный transform изображения. `#childPhotoSaved` доступен через каталог. |
| Открыть владельца / другого участника | `#family` | `#familyMember`, `#familyDad`, `#familyGrandma`, `#familyGrandpa` | Открываются четыре варианта карточки; права в статике не обеспечиваются. |
| Изменить доступ и сохранить | `#familyDad` | `#memberProfileSaved` | Radio full/viewer меняет checked; Save только навигирует, данные не сохраняются. |
| Изменить фото участника | Любой member profile | `#memberPhotoPicker` | Выбор файла/удаление показаны; возврат после удаления жёстко ведёт к `#familyGrandma`. |
| Удалить участника / отменить | `#familyDad` или `#familyGrandpa` | `#memberRemoveConfirm` → `#familyGrandma` | Диалог открыт; cancel ведёт к бабушке независимо от источника. |
| Пригласить, скопировать, присоединиться | `#familyInvite` | `#familyInviteReady` → `#familyInviteCopied` / `#inviteGuestPreview` → `#inviteGuestAccepted` → `#inviteGuestProfile` | Демо-ссылки и экраны результата без backend проверки токена. |
| Открыть / закрыть sheet | BASE / `#settingsMenu`, `#helpMenu` | Sheet / прежнее состояние | У add sheet меняются `.open` и `aria-hidden`; backdrop закрывает. |
| Выбрать тему | `#appearanceSettings` | Та же страница | Меняется checked radio и вычисленный акцент CSS; production должен использовать существующий provider. |
| Фильтр ребёнка, лайк, комментарий | BASE | BASE / `#commentsPost` | JS меняет видимые демо-карточки/счётчики; часть scope хранится в localStorage. |
| Добавить фото / заметку / аудио / видео | BASE | `#photoEmpty` / `#noteEmpty` / `#mediaChoice` и соответствующие progress/error/success | Демонстрация состояний, upload и публикация не происходят. |
| Ошибка / повтор / успех | Пример: `#mediaProgressVideo` | `#mediaErrorVideo` → `#mediaProgressVideo` → `#mediaSuccessVideo` | Статические сценарные переходы. Другая часть ошибок доступна лишь напрямую/из каталога. |
| Удалить воспоминание | `#memoryActions` | `#memoryDeleteSpotlight` | Demo JS может удалить DOM-карточку; не переносить как data flow. |

Инвентарь ниже содержит входы и выходы каждого состояния. Состояния без обычного входящего перехода перечислены после таблицы; прямая hash-навигация и каталог остаются способами визуального просмотра. При сравнении HTML как visual contract это не блокирует работу, но demo нельзя считать исполняемой спецификацией API/прав.
