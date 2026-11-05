# Подготовка

Base a18469ab8a54464d491659d849fcf286973fa9e4. Новой ветки или PR задачи не было. Production frontend/backend/worker/scheduler также a18469ab, 13 GiB свободно на первом read-only измерении. Canonical main локально имеет собственные коммиты, задача ведётся в отдельном worktree.

`AlbumsPage → AlbumEntryDetail → MixedMediaViewer`. Старый viewer перед открытием делает loadMemory для всех источников. `EntryEditor.save` делает full replace. `SourcePicker` уже пагинирует memories, `ComposerHost` интегрирует direct photo, общий composer ограничен 10. `PrismaAlbumRepository` сериализует записи на семье, альбоме и записи, сохраняет ID при полном replace и проектирует доступность через composed catalog. Recovery S3 pinned 26cfab9; release guard привязан к точным 65 миграциям и fingerprint. Legacy PUT пишет receipt set_sources внутри той же транзакции; на этой границе PostgreSQL может отклонить несовместимый legacy replace без потери источников.
