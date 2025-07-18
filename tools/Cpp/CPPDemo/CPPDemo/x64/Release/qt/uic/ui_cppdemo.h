/********************************************************************************
** Form generated from reading UI file 'cppdemo.ui'
**
** Created by: Qt User Interface Compiler version 6.9.1
**
** WARNING! All changes made in this file will be lost when recompiling UI file!
********************************************************************************/

#ifndef UI_CPPDEMO_H
#define UI_CPPDEMO_H

#include <QtCore/QVariant>
#include <QtWidgets/QApplication>
#include <QtWidgets/QMainWindow>
#include <QtWidgets/QMenuBar>
#include <QtWidgets/QStatusBar>
#include <QtWidgets/QToolBar>
#include <QtWidgets/QWidget>

QT_BEGIN_NAMESPACE

class Ui_CPPDemoClass
{
public:
    QMenuBar *menuBar;
    QToolBar *mainToolBar;
    QWidget *centralWidget;
    QStatusBar *statusBar;

    void setupUi(QMainWindow *CPPDemoClass)
    {
        if (CPPDemoClass->objectName().isEmpty())
            CPPDemoClass->setObjectName("CPPDemoClass");
        CPPDemoClass->resize(600, 400);
        menuBar = new QMenuBar(CPPDemoClass);
        menuBar->setObjectName("menuBar");
        CPPDemoClass->setMenuBar(menuBar);
        mainToolBar = new QToolBar(CPPDemoClass);
        mainToolBar->setObjectName("mainToolBar");
        CPPDemoClass->addToolBar(mainToolBar);
        centralWidget = new QWidget(CPPDemoClass);
        centralWidget->setObjectName("centralWidget");
        CPPDemoClass->setCentralWidget(centralWidget);
        statusBar = new QStatusBar(CPPDemoClass);
        statusBar->setObjectName("statusBar");
        CPPDemoClass->setStatusBar(statusBar);

        retranslateUi(CPPDemoClass);

        QMetaObject::connectSlotsByName(CPPDemoClass);
    } // setupUi

    void retranslateUi(QMainWindow *CPPDemoClass)
    {
        CPPDemoClass->setWindowTitle(QCoreApplication::translate("CPPDemoClass", "CPPDemo", nullptr));
    } // retranslateUi

};

namespace Ui {
    class CPPDemoClass: public Ui_CPPDemoClass {};
} // namespace Ui

QT_END_NAMESPACE

#endif // UI_CPPDEMO_H
