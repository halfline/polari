EXTRA_DIST =
CLEANFILES =
INTROSPECTION_GIRS =
BUILT_SOURCES =

girdir = $(pkgdatadir)/gir-1.0
typelibdir = $(pkglibdir)/girepository-1.0

include $(INTROSPECTION_MAKEFILE)
include Makefile-lib.am

gir_DATA = $(INTROSPECTION_GIRS)
typelib_DATA = $(gir_DATA:.gir=.typelib)

CLEANFILES += $(gir_DATA) $(typelib_DATA)

do_subst = sed -e 's|@localedir[@]|$(localedir)|g' \
               -e 's|@pkgdatadir[@]|$(pkgdatadir)|g' \
               -e 's|@pkglibdir[@]|$(pkglibdir)|g' \
               -e 's|@GJS_CONSOLE[@]|$(GJS_CONSOLE)|g' \
               -e 's|@PACKAGE_VERSION[@]|$(PACKAGE_VERSION)|g' \
               $(NULL)

config.js: config.js.in Makefile
	$(AM_V_GEN) $(do_subst) $< > $@

bin_PROGRAMS = polari

polari_SOURCES = \
	polari.c \
	$(NULL)

nodist_polari_SOURCES = \
	$(resource_built_sources)	\
	$(NULL)

AM_CPPFLAGS = \
	-DPOLARI_TYPELIBDIR=\""$(pkglibdir)/girepository-1.0"\" \
	-DLOCALEDIR=\""$(datadir)/locale"\" \
	-DGETTEXT_PACKAGE=\""$(GETTEXT_PACKAGE)"\" \
	$(POLARI_CFLAGS) \
	$(NULL)

polari_LDADD = \
	$(POLARI_LIBS) \
	libpolari-1.0.la \
	$(NULL)

resource_files=$(shell $(GLIB_COMPILE_RESOURCES) --sourcedir=$(srcdir) --generate-dependencies $(srcdir)/polari.gresource.xml)
resources.h: polari.gresource.xml $(resource_files) config.js
	$(AM_V_GEN) $(GLIB_COMPILE_RESOURCES) --target=$@ --sourcedir=$(srcdir) --sourcedir=$(builddir) --generate --c-name polari_resources $<
resources.c: polari.gresource.xml $(resource_files) config.js
	$(AM_V_GEN) $(GLIB_COMPILE_RESOURCES) --target=$@ --sourcedir=$(srcdir) --sourcedir=$(builddir) --generate --c-name polari_resources $<

resource_built_sources = resources.h resources.c

BUILT_SOURCES += $(resource_built_sources)

resource_dist_files = $(filter-out config.js, $(resource_files))

EXTRA_DIST += \
	config.js.in \
	$(resource_dist_files) \
	polari.gresource.xml \
	$(resource_files) \
	$(NULL)

CLEANFILES += \
	config.js \
	$(resource_built_sources)
	$(NULL)
